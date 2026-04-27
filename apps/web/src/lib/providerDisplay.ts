import type { TranscriptionProvider } from '@/types/jobs';

export const PROVIDER_LABEL: Record<TranscriptionProvider, string> = {
  deepgram: 'Deepgram Nova-3',
  openai: 'OpenAI gpt-4o-transcribe',
  assemblyai: 'AssemblyAI Universal-2',
};

export const PROVIDER_NOTES: Record<TranscriptionProvider, string> = {
  deepgram: 'Speaker labels, very fast, no per-file size limit. Default.',
  openai: 'High accuracy, no diarization, 25 MB hard file limit.',
  assemblyai: 'Speaker labels, slightly slower (poll-based).',
};

export const SHORT_PROVIDER_LABEL: Record<TranscriptionProvider, string> = {
  deepgram: 'Deepgram',
  openai: 'OpenAI',
  assemblyai: 'AssemblyAI',
};
