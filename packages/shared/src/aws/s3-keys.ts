import type { TranscriptionProviderName } from '../types/provider';

/**
 * Single source of truth for every S3 key the system writes or reads.
 * No string literals like `transcripts/${jobId}/...` should exist
 * outside this file.
 */

export const uploadKey = (jobId: string, sanitizedFileName: string): string =>
  `uploads/${jobId}/${sanitizedFileName}`;

export const transcriptTextKey = (jobId: string): string =>
  `transcripts/${jobId}/transcript.txt`;

/** Provider-aware so OpenAI / AssemblyAI raw responses aren't named "deepgram.json". */
export const rawJsonKey = (
  jobId: string,
  provider: TranscriptionProviderName,
): string => `transcripts/${jobId}/${provider}.json`;

/** Forensic capture for malformed SQS bodies the worker couldn't parse. */
export const dlqDebugKey = (messageId: string): string =>
  `dlq-debug/${new Date().toISOString().slice(0, 10)}/${messageId}.json`;
