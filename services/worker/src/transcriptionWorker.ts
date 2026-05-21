import { log } from './lib/logger';
import { config } from './lib/config';
import {
  receiveMessages,
  deleteMessage,
  returnToQueue,
  type ReceivedMessage,
} from './lib/sqs';
import { getJob, updateJob, incrementAttempts } from './lib/dynamo';
import {
  presignAudioGet,
  putBytes,
  putText,
  transcriptTextKey,
  rawJsonKey,
} from './lib/s3';
import { dlqDebugKey } from '@aptlyable/shared';
import {
  getProvider,
  NonRetryableTranscriptionError,
  type TranscriptionProviderName,
} from './providers';
import type { TranscriptionJobMessage } from './types/job';

interface RunOptions {
  signal: AbortSignal;
}

/**
 * Long-poll loop with bounded concurrency. Each iteration:
 *   1. Wait until concurrency has room.
 *   2. Long-poll SQS for up to MaxMessages messages.
 *   3. Dispatch each one to processMessage in the background.
 *   4. Repeat until shutdown signal fires.
 *
 * Each job's provider is read from the DDB record (with the SQS message
 * value as a fallback) so retries always use the originally chosen
 * provider.
 */
export async function runWorker(options: RunOptions): Promise<void> {
  const { signal } = options;

  log.info('worker started', {
    queueUrl: config.queueUrl,
    concurrency: config.workerConcurrency,
    defaultProvider: config.defaultProvider,
  });

  const inflight = new Set<Promise<void>>();

  while (!signal.aborted) {
    while (inflight.size >= config.workerConcurrency && !signal.aborted) {
      await Promise.race(inflight);
    }
    if (signal.aborted) break;

    let messages: ReceivedMessage[] = [];
    try {
      messages = await receiveMessages();
    } catch (err) {
      log.error('sqs receive failed', { error: errMsg(err) });
      await sleep(2_000, signal);
      continue;
    }

    if (messages.length === 0) continue;

    for (const message of messages) {
      const task = processMessage(message)
        .catch((err) =>
          log.error('processMessage threw (should never happen)', {
            messageId: message.messageId,
            error: errMsg(err),
          }),
        )
        .finally(() => inflight.delete(task));
      inflight.add(task);

      if (inflight.size >= config.workerConcurrency) break;
    }
  }

  log.info('shutdown initiated, draining in-flight jobs', { inflight: inflight.size });
  await Promise.allSettled(Array.from(inflight));
  log.info('worker stopped cleanly');
}

async function processMessage(message: ReceivedMessage): Promise<void> {
  let parsed: TranscriptionJobMessage;
  try {
    parsed = JSON.parse(message.body) as TranscriptionJobMessage;
    if (!parsed.jobId || !parsed.s3Key || !parsed.bucket) {
      throw new Error('Missing required fields on message body.');
    }
  } catch (err) {
    // Capture forensics before discarding so a future bad-producer
    // bug isn't silent. Stored under dlq-debug/YYYY-MM-DD/<msgId>.json.
    const debugKey = dlqDebugKey(message.messageId);
    await putBytes({
      key: debugKey,
      body: Buffer.from(message.body, 'utf-8'),
      contentType: 'application/octet-stream',
    }).catch((putErr) =>
      log.warn('failed to capture malformed sqs body', {
        messageId: message.messageId,
        error: errMsg(putErr),
      }),
    );
    log.error('malformed sqs message — discarding', {
      messageId: message.messageId,
      error: errMsg(err),
      debugKey,
    });
    await safeDelete(message.receiptHandle);
    return;
  }

  const { jobId } = parsed;
  log.info('job received', { jobId, messageId: message.messageId });

  const job = await getJob(jobId);
  if (!job) {
    log.warn('job not found in DDB — discarding', { jobId });
    await safeDelete(message.receiptHandle);
    return;
  }

  if (job.status === 'completed') {
    log.info('job already completed — discarding message', { jobId });
    await safeDelete(message.receiptHandle);
    return;
  }

  // DDB is the source of truth; fall back to the SQS message field for
  // back-compat, then to the default provider.
  const providerName: TranscriptionProviderName = (job.provider ??
    parsed.provider ??
    config.defaultProvider) as TranscriptionProviderName;

  const startedAt = new Date().toISOString();
  await updateJob(jobId, {
    status: 'transcribing',
    startedAt,
    errorMessage: undefined,
    provider: providerName,
  });
  await incrementAttempts(jobId);

  try {
    const provider = getProvider(providerName);
    const signedAudioUrl = await presignAudioGet(parsed.s3Key);

    const t0 = Date.now();
    const result = await provider.transcribe({
      s3Key: parsed.s3Key,
      fileName: parsed.fileName,
      signedAudioUrl,
      sizeBytes: job.size,
      contentType: job.contentType,
    });
    log.info('provider completed', {
      jobId,
      provider: providerName,
      ms: Date.now() - t0,
      providerRequestId: result.providerRequestId,
    });

    const txtKey = transcriptTextKey(jobId);
    const jsonKey = rawJsonKey(jobId, providerName);

    await Promise.all([
      putText(txtKey, result.text, 'text/plain; charset=utf-8'),
      putText(
        jsonKey,
        JSON.stringify(result.rawJson, null, 2),
        'application/json; charset=utf-8',
      ),
    ]);

    await updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      transcriptTextKey: txtKey,
      rawJsonKey: jsonKey,
      durationSeconds: result.durationSeconds,
      wordCount: result.wordCount,
      providerRequestId: result.providerRequestId,
    });

    await safeDelete(message.receiptHandle);
    log.info('job completed', { jobId, provider: providerName, wordCount: result.wordCount });
  } catch (err) {
    const message_ = errMsg(err);
    const retryable = !(err instanceof NonRetryableTranscriptionError);
    log.error('job failed', { jobId, provider: providerName, error: message_, retryable });

    await updateJob(jobId, {
      status: 'failed',
      failedAt: new Date().toISOString(),
      errorMessage: message_.slice(0, 1000),
    });

    if (retryable) {
      await returnToQueue(message.receiptHandle).catch(() => undefined);
    } else {
      await safeDelete(message.receiptHandle);
    }
  }
}

async function safeDelete(receiptHandle: string): Promise<void> {
  try {
    await deleteMessage(receiptHandle);
  } catch (err) {
    log.warn('sqs delete failed', { error: errMsg(err) });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}
