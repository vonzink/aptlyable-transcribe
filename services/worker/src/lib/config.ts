import {
  required,
  optional,
  optionalUndef,
  intEnv,
  DEFAULT_SQS_VISIBILITY_TIMEOUT_SECONDS,
} from '@aptlyable/shared';

export const config = {
  region: optional('AWS_REGION', 'us-east-1'),
  bucketName: required('S3_BUCKET_NAME'),
  jobsTableName: required('JOBS_TABLE_NAME'),
  queueUrl: required('TRANSCRIPTION_QUEUE_URL'),

  // Per-provider Secrets Manager secret names. Each is independent —
  // the worker only fetches the one(s) it actually needs based on
  // incoming jobs.
  deepgramSecretName: optional('DEEPGRAM_SECRET_NAME', 'aptlyable/deepgram/api-key'),
  openaiSecretName: optional('OPENAI_SECRET_NAME', 'aptlyable/openai/api-key'),
  assemblyaiSecretName: optional('ASSEMBLYAI_SECRET_NAME', 'aptlyable/assemblyai/api-key'),

  workerConcurrency: intEnv('WORKER_CONCURRENCY', 3),
  sqsWaitTimeSeconds: intEnv('SQS_WAIT_TIME_SECONDS', 20),
  sqsMaxMessages: Math.min(intEnv('SQS_MAX_MESSAGES', 5), 10),
  sqsVisibilityTimeoutSeconds: intEnv(
    'SQS_VISIBILITY_TIMEOUT_SECONDS',
    DEFAULT_SQS_VISIBILITY_TIMEOUT_SECONDS,
  ),
  presignedDownloadExpiresSeconds: intEnv('PRESIGNED_DOWNLOAD_EXPIRES_SECONDS', 900),

  // Default provider used when a job message has no provider field
  // (back-compat with old enqueued messages and the simplest UX path).
  defaultProvider: optional('DEFAULT_PROVIDER', 'deepgram'),

  deepgramModel: optional('DEEPGRAM_MODEL', 'nova-3'),
  deepgramLanguage: optional('DEEPGRAM_LANGUAGE', 'en'),

  openaiModel: optional('OPENAI_MODEL', 'gpt-4o-transcribe'),
  // OpenAI's `language` param is optional (auto-detect when omitted).
  openaiLanguage: optionalUndef('OPENAI_LANGUAGE'),

  assemblyaiModel: optional('ASSEMBLYAI_MODEL', 'universal'),
  assemblyaiLanguage: optional('ASSEMBLYAI_LANGUAGE', 'en'),
};
