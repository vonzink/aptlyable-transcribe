import type { TranscriptionProviderName } from './provider';

/**
 * Status transitions:
 *   pending_upload → uploaded → queued → transcribing → completed
 *                                  └─────────────► failed
 *                                  └──── (retry) ──► queued
 */
export type JobStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'queued'
  | 'transcribing'
  | 'completed'
  | 'failed';

export const ALL_STATUSES: JobStatus[] = [
  'pending_upload',
  'uploaded',
  'queued',
  'transcribing',
  'completed',
  'failed',
];

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (ALL_STATUSES as string[]).includes(value);
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function isActive(status: JobStatus): boolean {
  return status === 'queued' || status === 'transcribing' || status === 'uploaded';
}

export type JobSource = 'upload' | 'twilio';

export interface TwilioJobMeta {
  callSid: string;
  recordingSid: string;
  from?: string;
  to?: string;
  recordingDurationSeconds?: number;
  /** Twilio account that owns the recording. */
  accountSid?: string;
}

export interface JobRecord {
  jobId: string;

  /** Sanitized file name used for S3 key + display. */
  fileName: string;
  /** Raw file name from the upload (preserved for display only). */
  originalFileName: string;
  contentType: string;
  size: number;

  status: JobStatus;

  /** How this job entered the system. Defaults to "upload" for back-compat. */
  source?: JobSource;
  /** Present iff source === 'twilio'. */
  twilio?: TwilioJobMeta;
  /**
   * Top-level promotion of `twilio.recordingSid`. DynamoDB GSIs cannot
   * key on nested attributes, so we duplicate the value to the root
   * for the `twilio-recording-sid-index` GSI used in idempotency
   * lookups. Always set in lockstep with `twilio.recordingSid`.
   */
  twilioRecordingSid?: string;

  /** Which transcription backend will handle / handled this job. */
  provider?: TranscriptionProviderName;

  uploadS3Key: string;
  transcriptTextKey?: string;
  rawJsonKey?: string;

  /** ISO-8601 strings. */
  createdAt: string;
  uploadedAt?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;

  errorMessage?: string;
  attempts: number;

  durationSeconds?: number;
  wordCount?: number;
  /** Provider-side request id (Deepgram, OpenAI, AssemblyAI). */
  providerRequestId?: string;
}
