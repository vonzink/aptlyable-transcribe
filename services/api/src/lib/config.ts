/**
 * Centralized config — all env reads happen here so handlers never
 * touch process.env directly. Throws fast on misconfiguration.
 */
import {
  required,
  optional,
  intEnv,
  DEFAULT_MAX_FILE_SIZE_MB,
  OPENAI_MAX_AUDIO_BYTES,
} from '@aptlyable/shared';

export const config = {
  region: optional('AWS_REGION', 'us-east-1'),
  bucketName: required('S3_BUCKET_NAME'),
  jobsTableName: required('JOBS_TABLE_NAME'),
  jobsTableStatusIndex: optional('JOBS_TABLE_STATUS_INDEX', 'status-createdAt-index'),
  jobsTableTwilioIndex: optional('JOBS_TABLE_TWILIO_INDEX', 'twilio-recording-sid-index'),
  queueUrl: required('TRANSCRIPTION_QUEUE_URL'),

  maxFileSizeBytes: intEnv('MAX_FILE_SIZE_MB', DEFAULT_MAX_FILE_SIZE_MB) * 1024 * 1024,
  uploadUrlTtlSeconds: intEnv('PRESIGNED_UPLOAD_EXPIRES_SECONDS', 900),
  downloadUrlTtlSeconds: intEnv('PRESIGNED_DOWNLOAD_EXPIRES_SECONDS', 900),

  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),

  /** Default transcription provider when the client doesn't specify one. */
  defaultProvider: optional('DEFAULT_PROVIDER', 'deepgram'),

  /** OpenAI's hard 25 MB cap on /v1/audio/transcriptions input. */
  openaiMaxFileSizeBytes: OPENAI_MAX_AUDIO_BYTES,

  /** Secrets Manager id for the Twilio auth token (used by webhook). */
  twilioSecretName: optional('TWILIO_SECRET_NAME', 'aptlyable/twilio/auth-token'),
};
