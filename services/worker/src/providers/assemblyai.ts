import { request } from 'undici';
import { countWords } from '@aptlyable/shared';
import { config } from '../lib/config';
import { log } from '../lib/logger';
import { getProviderApiKey } from '../lib/secrets';
import {
  type TranscribeInput,
  type TranscriptionProvider,
  type TranscriptionResult,
  NonRetryableTranscriptionError,
} from './types';

/**
 * AssemblyAI is async:
 *   1. POST /v2/transcript with { audio_url } → { id, status: 'queued' }
 *   2. GET /v2/transcript/{id} until status is 'completed' or 'error'.
 *
 * Polling cadence is conservative — start at 3s, max 15s — to keep the
 * worker responsive without hammering AAI for short jobs.
 */
const POLL_INTERVAL_START_MS = 3_000;
const POLL_INTERVAL_MAX_MS = 15_000;

interface AssemblyAIWord {
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: string | null;
}

interface AssemblyAIUtterance {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
  words?: AssemblyAIWord[];
}

export interface AssemblyAITranscript {
  id?: string;
  status?: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  utterances?: AssemblyAIUtterance[] | null;
  words?: AssemblyAIWord[];
  audio_duration?: number;
  error?: string;
  language_code?: string;
}

export class AssemblyAIProvider implements TranscriptionProvider {
  readonly name = 'assemblyai' as const;

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const apiKey = await getProviderApiKey('assemblyai');

    // Step 1: submit the job.
    const submitRes = await request('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: input.signedAudioUrl,
        speech_model: config.assemblyaiModel, // e.g. "universal"
        punctuate: true,
        format_text: true,
        speaker_labels: true,
        language_code: config.assemblyaiLanguage,
      }),
      headersTimeout: 60_000,
    });

    const submitStatus = submitRes.statusCode;
    const submitBody = await submitRes.body.text();

    if (submitStatus < 200 || submitStatus >= 300) {
      const retryable =
        submitStatus === 408 || submitStatus === 429 || submitStatus >= 500;
      const message = `AssemblyAI submit failed (${submitStatus}): ${submitBody.slice(0, 500)}`;
      if (!retryable) throw new NonRetryableTranscriptionError(message);
      throw new Error(message);
    }

    let submitted: AssemblyAITranscript;
    try {
      submitted = JSON.parse(submitBody) as AssemblyAITranscript;
    } catch (err) {
      throw new Error(
        `AssemblyAI submit returned non-JSON: ${(err as Error).message}`,
      );
    }
    if (!submitted.id) {
      throw new Error('AssemblyAI submit returned no transcript id.');
    }

    // Step 2: poll until terminal. Worker SQS visibility timeout caps the
    // total wait — we just keep the inner sleep bounded.
    const transcriptId = submitted.id;
    const startedAt = Date.now();
    const maxWaitMs = config.sqsVisibilityTimeoutSeconds * 1000 - 30_000;
    let interval = POLL_INTERVAL_START_MS;

    while (true) {
      if (Date.now() - startedAt > maxWaitMs) {
        throw new Error(`AssemblyAI transcript ${transcriptId} did not complete in time.`);
      }

      await sleep(interval);
      interval = Math.min(Math.round(interval * 1.4), POLL_INTERVAL_MAX_MS);

      const pollRes = await request(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          method: 'GET',
          headers: { Authorization: apiKey },
          headersTimeout: 30_000,
        },
      );
      const pollStatus = pollRes.statusCode;
      const pollBody = await pollRes.body.text();

      if (pollStatus < 200 || pollStatus >= 300) {
        // Treat polling errors as transient — the submit succeeded.
        log.warn('assemblyai poll non-2xx', { transcriptId, status: pollStatus });
        continue;
      }

      let polled: AssemblyAITranscript;
      try {
        polled = JSON.parse(pollBody) as AssemblyAITranscript;
      } catch {
        log.warn('assemblyai poll non-JSON body', { transcriptId });
        continue;
      }

      if (polled.status === 'completed') {
        return formatAssemblyAIResponse(polled);
      }

      if (polled.status === 'error') {
        const message = `AssemblyAI transcript ${transcriptId} errored: ${polled.error ?? 'unknown'}`;
        throw new NonRetryableTranscriptionError(message);
      }
    }
  }
}

export function formatAssemblyAIResponse(resp: AssemblyAITranscript): TranscriptionResult {
  const utterances = resp.utterances ?? [];
  let text: string;

  if (utterances.length > 0) {
    text = utterances
      .map((u) => {
        const t = (u.text ?? '').trim();
        if (!t) return '';
        const speaker = u.speaker ? `Speaker ${u.speaker}: ` : '';
        return `${speaker}${t}`;
      })
      .filter(Boolean)
      .join('\n\n');
  } else {
    text = (resp.text ?? '').trim();
  }

  return {
    text,
    rawJson: resp,
    wordCount: countWords(text),
    durationSeconds: resp.audio_duration,
    providerRequestId: resp.id,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
