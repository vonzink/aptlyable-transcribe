import { z } from 'zod';
import { config } from './config';
import { ALL_PROVIDERS, type TranscriptionProviderName } from '../types/job';

/**
 * MP3 must end with .mp3 and have an audio/mpeg-ish content type.
 * Some browsers send "audio/mp3" or "audio/mpeg3" — accept those too.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mpeg3',
  'audio/x-mpeg-3',
  'audio/x-mp3',
]);

/**
 * Sanitize a filename for safe S3 keys + display:
 *   - strip path separators
 *   - keep alphanumerics, dot, dash, underscore, parens, space
 *   - collapse whitespace to single underscores
 *   - cap to 200 chars
 *
 * Always returns a non-empty string.
 */
export function sanitizeFileName(input: string): string {
  const noPath = input.replace(/^.*[\\/]/, '');
  const cleaned = noPath
    .replace(/[^A-Za-z0-9._\-() ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const trimmed = cleaned.slice(0, 200);
  if (!trimmed) return 'audio.mp3';
  if (!/\.mp3$/i.test(trimmed)) {
    return `${trimmed}.mp3`;
  }
  return trimmed;
}

export const ProviderSchema = z.enum(ALL_PROVIDERS as [TranscriptionProviderName, ...TranscriptionProviderName[]]);

export const FileSchema = z.object({
  fileName: z.string().min(1).max(500),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
  /** Optional per-file provider; falls back to top-level provider, then default. */
  provider: ProviderSchema.optional(),
  /**
   * Optional client-supplied id, echoed back on the response so the
   * frontend can match upload rows without filename collisions.
   */
  clientId: z.string().min(1).max(64).optional(),
});

export const CreateUploadsSchema = z.object({
  files: z.array(FileSchema).min(1).max(500),
  /** Optional top-level provider applied to all files lacking their own. */
  provider: ProviderSchema.optional(),
});

export const CompleteUploadsSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(500),
});

export type FileInput = z.infer<typeof FileSchema>;

export interface FileValidation {
  ok: boolean;
  reason?: string;
}

/** Validate a single file's metadata against MP3, size, and provider rules. */
export function validateFile(
  input: FileInput,
  provider: TranscriptionProviderName,
): FileValidation {
  const lower = input.fileName.toLowerCase();
  if (!lower.endsWith('.mp3')) {
    return { ok: false, reason: 'Only .mp3 files are supported.' };
  }
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType.toLowerCase())) {
    return {
      ok: false,
      reason: `Unsupported content type "${input.contentType}". Expected audio/mpeg.`,
    };
  }
  if (input.size <= 0) {
    return { ok: false, reason: 'File size must be greater than zero.' };
  }
  if (input.size > config.maxFileSizeBytes) {
    const mb = (config.maxFileSizeBytes / (1024 * 1024)).toFixed(0);
    return { ok: false, reason: `File exceeds max size of ${mb} MB.` };
  }
  if (provider === 'openai' && input.size > config.openaiMaxFileSizeBytes) {
    const mb = (config.openaiMaxFileSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      reason: `OpenAI gpt-4o-transcribe rejects files over ${mb} MB. Choose Deepgram or AssemblyAI for this file.`,
    };
  }
  return { ok: true };
}

export function resolveProvider(
  fileLevel: TranscriptionProviderName | undefined,
  topLevel: TranscriptionProviderName | undefined,
): TranscriptionProviderName {
  if (fileLevel) return fileLevel;
  if (topLevel) return topLevel;
  if (
    config.defaultProvider === 'deepgram' ||
    config.defaultProvider === 'openai' ||
    config.defaultProvider === 'assemblyai'
  ) {
    return config.defaultProvider;
  }
  return 'deepgram';
}
