export type SupportedMediaExtension = 'mp3' | 'mp4';

const MP3_CONTENT_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mpeg3',
  'audio/x-mpeg-3',
  'audio/x-mp3',
]);

const MP4_CONTENT_TYPES = new Set([
  'video/mp4',
  'audio/mp4',
  'application/mp4',
]);

export const SUPPORTED_MEDIA_EXTENSIONS = ['.mp3', '.mp4'] as const;

export const SUPPORTED_MEDIA_ACCEPT =
  '.mp3,.mp4,audio/mpeg,audio/mp3,video/mp4,audio/mp4,application/mp4';

export const SUPPORTED_MEDIA_LABEL = 'MP3 or MP4';

export function getSupportedMediaExtension(fileName: string): SupportedMediaExtension | undefined {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.mp4')) return 'mp4';
  return undefined;
}

export function isSupportedMediaFileName(fileName: string): boolean {
  return getSupportedMediaExtension(fileName) !== undefined;
}

export function defaultContentTypeForFileName(fileName: string): string {
  return getSupportedMediaExtension(fileName) === 'mp4' ? 'video/mp4' : 'audio/mpeg';
}

export function isSupportedMediaContentType(fileName: string, contentType: string): boolean {
  const extension = getSupportedMediaExtension(fileName);
  if (!extension) return false;

  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!normalized) return false;

  return extension === 'mp4'
    ? MP4_CONTENT_TYPES.has(normalized)
    : MP3_CONTENT_TYPES.has(normalized);
}
