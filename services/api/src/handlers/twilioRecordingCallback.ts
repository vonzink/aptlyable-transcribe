import { v4 as uuid } from 'uuid';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { wrap } from '../lib/response';
// (Logger flows in via the wrap()-supplied requestLog parameter.)
import {
  getTwilioAuthToken,
  isValidTwilioSignature,
  parseFormBody,
  downloadTwilioRecording,
} from '../lib/twilio';
import { findJobByTwilioRecordingSid, putJob } from '../lib/dynamo';
import { putBytes, uploadKey } from '../lib/s3';
import { enqueueJob } from '../lib/sqs';
import { sanitizeFileName } from '../lib/validation';
import { config } from '../lib/config';
import {
  ALL_PROVIDERS,
  type JobRecord,
  type TranscriptionProviderName,
} from '../types/job';

/**
 * Twilio webhook → S3 ingest → SQS enqueue.
 *
 * Configure Twilio's recordingStatusCallback to:
 *   POST {ApiUrl}/api/twilio/recording-callback?provider=deepgram
 *
 * The optional `provider` query param maps the recording to a
 * transcription engine. Omit it to use DEFAULT_PROVIDER.
 *
 * Returns 200 on success (and on idempotent replays). Twilio retries
 * non-2xx responses; we deliberately keep the surface small and
 * recover via Twilio's retry behavior on transient AWS failures.
 */
export const handler = wrap(async (event, requestLog): Promise<APIGatewayProxyResultV2> => {
  // Twilio always sends form-urlencoded.
  const rawBody = decodeBody(event);
  const params = parseFormBody(rawBody);

  // 1) Validate signature against the URL Twilio actually called.
  const signatureHeader =
    event.headers?.['x-twilio-signature'] ?? event.headers?.['X-Twilio-Signature'] ?? '';
  const fullUrl = reconstructUrl(event);
  const authToken = await getTwilioAuthToken();

  if (!isValidTwilioSignature({ authToken, url: fullUrl, params, signatureHeader })) {
    requestLog.warn('twilio signature validation failed', { url: fullUrl });
    return text(403, 'invalid signature');
  }

  // 2) Only act on completed recordings. Twilio also sends
  //    `in-progress` and `failed` callbacks if those are subscribed.
  const recordingStatus = params.RecordingStatus;
  if (recordingStatus && recordingStatus !== 'completed') {
    requestLog.info('twilio non-terminal recording status — ack and skip', {
      recordingStatus,
      recordingSid: params.RecordingSid,
    });
    return text(200, 'ok');
  }

  const recordingSid = params.RecordingSid;
  const accountSid = params.AccountSid;
  const callSid = params.CallSid;
  const recordingUrl = params.RecordingUrl;
  if (!recordingSid || !accountSid || !recordingUrl) {
    requestLog.error('twilio webhook missing required fields', {
      hasSid: !!recordingSid,
      hasAccount: !!accountSid,
      hasUrl: !!recordingUrl,
    });
    return text(400, 'missing required twilio fields');
  }

  // 3) Idempotency — Twilio retries. If we already have a job for
  //    this RecordingSid, ack without re-creating.
  const existing = await findJobByTwilioRecordingSid(recordingSid);
  if (existing) {
    requestLog.info('twilio webhook duplicate — ack', {
      jobId: existing.jobId,
      recordingSid,
    });
    return text(200, 'ok');
  }

  // 4) Resolve provider from query string.
  const provider = resolveProviderFromQuery(event.queryStringParameters?.provider);

  // 5) Download recording → S3.
  const audio = await downloadTwilioRecording({
    accountSid,
    recordingUrl,
    authToken,
  });

  const jobId = uuid();
  const fileName = sanitizeFileName(`twilio_${recordingSid}.mp3`);
  const s3Key = uploadKey(jobId, fileName);
  await putBytes({
    key: s3Key,
    body: audio,
    contentType: 'audio/mpeg',
  });

  // 6) Create DDB row + enqueue. We jump straight to "queued" — there
  //    is no separate upload-complete step for Twilio jobs.
  const now = new Date().toISOString();
  const recordingDurationRaw = params.RecordingDuration;
  const recordingDurationSeconds = recordingDurationRaw
    ? Number(recordingDurationRaw)
    : undefined;

  const job: JobRecord = {
    jobId,
    fileName,
    originalFileName: `Twilio call ${callSid ?? recordingSid}`,
    contentType: 'audio/mpeg',
    size: audio.byteLength,
    status: 'queued',
    source: 'twilio',
    twilio: {
      callSid: callSid ?? '',
      recordingSid,
      from: params.From,
      to: params.To,
      recordingDurationSeconds: Number.isFinite(recordingDurationSeconds)
        ? recordingDurationSeconds
        : undefined,
      accountSid,
    },
    // Promoted to top-level for the GSI lookup used by findJobByTwilioRecordingSid.
    twilioRecordingSid: recordingSid,
    provider,
    uploadS3Key: s3Key,
    createdAt: now,
    uploadedAt: now,
    queuedAt: now,
    attempts: 0,
  };

  await putJob(job);

  await enqueueJob({
    jobId,
    bucket: config.bucketName,
    s3Key,
    fileName,
    provider,
  });

  requestLog.info('twilio recording ingested', {
    jobId,
    recordingSid,
    callSid,
    provider,
    sizeBytes: audio.byteLength,
  });

  return text(200, 'ok');
});

function decodeBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;
}

/**
 * Reconstruct the exact URL Twilio called — the signature includes it,
 * so this needs to match byte-for-byte. API Gateway HTTP API gives us
 * `domainName`, `rawPath`, and `rawQueryString`.
 */
function reconstructUrl(event: APIGatewayProxyEventV2): string {
  const proto = event.headers?.['x-forwarded-proto'] ?? 'https';
  const host = event.headers?.['x-forwarded-host'] ?? event.requestContext?.domainName;
  const path = event.rawPath ?? '';
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';
  return `${proto}://${host}${path}${qs}`;
}

function resolveProviderFromQuery(raw: string | undefined): TranscriptionProviderName {
  if (raw && (ALL_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as TranscriptionProviderName;
  }
  if ((ALL_PROVIDERS as readonly string[]).includes(config.defaultProvider)) {
    return config.defaultProvider as TranscriptionProviderName;
  }
  return 'deepgram';
}

function text(status: number, body: string): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  };
}
