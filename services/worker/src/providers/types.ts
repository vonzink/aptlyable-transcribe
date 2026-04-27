/**
 * Shared provider abstraction. Each transcription backend (Deepgram,
 * OpenAI, AssemblyAI) implements this interface, and the worker
 * dispatches based on the per-job `provider` field.
 *
 * Providers own:
 *   - HTTP transport to their API
 *   - parsing the raw response into a normalized text + word count
 *   - returning the raw response so we can persist it untouched in S3
 *
 * Providers do NOT own: S3 reads/writes, DDB updates, SQS handling.
 * Those stay in the worker so all provider impls stay focused.
 */

export type TranscriptionProviderName = 'deepgram' | 'openai' | 'assemblyai';

export const ALL_PROVIDERS: TranscriptionProviderName[] = [
  'deepgram',
  'openai',
  'assemblyai',
];

export interface TranscribeInput {
  /** Logical S3 key of the audio file. */
  s3Key: string;
  /** Original (sanitized) filename — some APIs want a multipart filename. */
  fileName: string;
  /** Pre-signed GET URL the provider can use to download the audio. */
  signedAudioUrl: string;
  /** Reported size in bytes (used for client-side size limit checks). */
  sizeBytes: number;
}

export interface TranscriptionResult {
  /** Pretty plain text, ready to save as transcript.txt. */
  text: string;
  /** Native provider response, saved verbatim as <provider>.json (e.g. deepgram.json, openai.json, assemblyai.json). */
  rawJson: unknown;
  wordCount: number;
  durationSeconds?: number;
  /** Provider-side request id (used for support tickets / debugging). */
  providerRequestId?: string;
}

export interface TranscriptionProvider {
  readonly name: TranscriptionProviderName;
  transcribe(input: TranscribeInput): Promise<TranscriptionResult>;
}

/**
 * Errors that should NOT be retried (bad input, rejected by provider).
 * Worker catches these specifically and deletes the SQS message instead
 * of letting it redrive into the DLQ.
 */
export class NonRetryableTranscriptionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NonRetryableTranscriptionError';
  }
}
