import { DeepgramProvider } from './deepgram';
import { OpenAIProvider } from './openai';
import { AssemblyAIProvider } from './assemblyai';
import { type TranscriptionProvider, type TranscriptionProviderName } from './types';

const registry: Record<TranscriptionProviderName, TranscriptionProvider> = {
  deepgram: new DeepgramProvider(),
  openai: new OpenAIProvider(),
  assemblyai: new AssemblyAIProvider(),
};

export function getProvider(name: string): TranscriptionProvider {
  const provider = registry[name as TranscriptionProviderName];
  if (!provider) {
    throw new Error(
      `Unknown transcription provider "${name}". Allowed: ${Object.keys(registry).join(', ')}.`,
    );
  }
  return provider;
}

export {
  type TranscriptionProvider,
  type TranscriptionProviderName,
  type TranscribeInput,
  type TranscriptionResult,
  NonRetryableTranscriptionError,
  ALL_PROVIDERS,
} from './types';
