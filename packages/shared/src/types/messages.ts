import type { TranscriptionProviderName } from './provider';

/** Canonical SQS payload for a transcription job. */
export interface TranscriptionJobMessage {
  jobId: string;
  bucket: string;
  s3Key: string;
  fileName: string;
  /** Optional in the message — worker prefers the DDB record's value. */
  provider?: TranscriptionProviderName;
}
