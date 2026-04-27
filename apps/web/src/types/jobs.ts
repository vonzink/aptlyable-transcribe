import type {
  JobRecord,
  TranscriptionProviderName,
} from '@aptlyable/shared';

export type {
  JobStatus,
  JobSource,
  TwilioJobMeta,
} from '@aptlyable/shared';

/**
 * Web naming: keep `Job` and `TranscriptionProvider` (shorter than the
 * canonical shared names) since the UI vocabulary already uses them.
 */
export type Job = JobRecord;
export type TranscriptionProvider = TranscriptionProviderName;

// ---- Web-only API contract types ---------------------------------

export interface UploadEntry {
  jobId: string;
  fileName: string;
  uploadUrl: string;
  s3Key: string;
  provider: TranscriptionProvider;
  /** Echo of the client-supplied id we sent in the request. */
  clientId?: string;
}

export interface CreateUploadsResponse {
  uploads: UploadEntry[];
  rejected: Array<{ fileName: string; reason: string; clientId?: string }>;
}

export interface CompleteUploadsResponse {
  results: Array<{
    jobId: string;
    status:
      | 'queued'
      | 'failed'
      | 'already_completed'
      | 'not_found'
      | 'missing_object'
      | 'invalid_state';
    message?: string;
  }>;
}

export interface ListJobsResponse {
  items: Job[];
  cursor?: string;
}

export interface TranscriptResponse {
  jobId: string;
  fileName: string;
  text: string;
  downloadUrl: string;
  durationSeconds?: number;
  wordCount?: number;
}

/**
 * Local-only state for files queued in the browser before they have a
 * jobId from the server.
 */
export interface LocalUpload {
  localId: string;
  file: File;
  status:
    | 'pending'
    | 'requesting_url'
    | 'uploading'
    | 'uploaded'
    | 'failed'
    | 'rejected';
  progress: number;
  jobId?: string;
  error?: string;
}
