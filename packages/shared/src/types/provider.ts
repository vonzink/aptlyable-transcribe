export type TranscriptionProviderName = 'deepgram' | 'openai' | 'assemblyai';

export const ALL_PROVIDERS: TranscriptionProviderName[] = [
  'deepgram',
  'openai',
  'assemblyai',
];

export function isProviderName(value: unknown): value is TranscriptionProviderName {
  return typeof value === 'string' && (ALL_PROVIDERS as string[]).includes(value);
}
