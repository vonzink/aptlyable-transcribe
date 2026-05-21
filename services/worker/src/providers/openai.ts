import { request, FormData } from 'undici';
import {
  countWords,
  defaultContentTypeForFileName,
  OPENAI_MAX_AUDIO_BYTES,
} from '@aptlyable/shared';
import { config } from '../lib/config';
import { getProviderApiKey } from '../lib/secrets';
import {
  type TranscribeInput,
  type TranscriptionProvider,
  type TranscriptionResult,
  NonRetryableTranscriptionError,
} from './types';

/**
 * OpenAI gpt-4o-transcribe quirks vs Deepgram/AssemblyAI:
 *   - Endpoint takes multipart file bytes, NOT a URL. Worker must
 *     download from S3 first, then POST.
 *   - 25 MB hard limit on the audio file.
 *   - No native speaker diarization.
 *   - response_format=verbose_json gives word-level timestamps but no
 *     speaker labels. We use 'json' for a compact { text, ... } shape.
 */

interface OpenAIVerboseSegment {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
}

interface OpenAITranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: OpenAIVerboseSegment[];
}

export class OpenAIProvider implements TranscriptionProvider {
  readonly name = 'openai' as const;

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    if (input.sizeBytes > OPENAI_MAX_AUDIO_BYTES) {
      throw new NonRetryableTranscriptionError(
        `OpenAI gpt-4o-transcribe rejects files over 25 MB. ` +
          `This file is ${(input.sizeBytes / 1024 / 1024).toFixed(1)} MB.`,
      );
    }

    const apiKey = await getProviderApiKey('openai');

    // Step 1: Download the audio bytes via the presigned S3 URL.
    const audioRes = await request(input.signedAudioUrl, { method: 'GET' });
    if (audioRes.statusCode < 200 || audioRes.statusCode >= 300) {
      throw new Error(`Failed to fetch audio from S3 (${audioRes.statusCode}).`);
    }
    const audioBuffer = Buffer.from(await audioRes.body.arrayBuffer());

    if (audioBuffer.byteLength > OPENAI_MAX_AUDIO_BYTES) {
      throw new NonRetryableTranscriptionError(
        `Downloaded audio (${audioBuffer.byteLength} bytes) exceeds OpenAI's 25 MB limit.`,
      );
    }

    // Step 2: Multipart POST to the transcriptions endpoint.
    const form = new FormData();
    form.set(
      'file',
      new Blob([audioBuffer], {
        type: input.contentType || defaultContentTypeForFileName(input.fileName),
      }),
      input.fileName,
    );
    form.set('model', config.openaiModel);
    form.set('response_format', 'verbose_json');
    if (config.openaiLanguage) {
      form.set('language', config.openaiLanguage);
    }

    const res = await request('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      bodyTimeout: config.sqsVisibilityTimeoutSeconds * 1000,
      headersTimeout: 60_000,
    });

    const status = res.statusCode;
    const text = await res.body.text();

    if (status < 200 || status >= 300) {
      const retryable = status === 408 || status === 429 || status >= 500;
      const message = `OpenAI request failed (${status}): ${text.slice(0, 500)}`;
      if (!retryable) throw new NonRetryableTranscriptionError(message);
      throw new Error(message);
    }

    let parsed: OpenAITranscriptionResponse;
    try {
      parsed = JSON.parse(text) as OpenAITranscriptionResponse;
    } catch (err) {
      throw new Error(
        `OpenAI returned non-JSON 2xx response: ${(err as Error).message}`,
      );
    }

    const requestId = res.headers['x-request-id'];
    return formatOpenAIResponse(parsed, typeof requestId === 'string' ? requestId : undefined);
  }
}

export function formatOpenAIResponse(
  resp: OpenAITranscriptionResponse,
  requestId?: string,
): TranscriptionResult {
  // No diarization available — best we can do is segment-by-segment
  // when verbose_json provides them, otherwise just dump the text.
  const segments = resp.segments ?? [];
  let text: string;
  if (segments.length > 0) {
    text = segments
      .map((s) => (s.text ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  } else {
    text = (resp.text ?? '').trim();
  }

  return {
    text,
    rawJson: resp,
    wordCount: countWords(text),
    durationSeconds: resp.duration,
    providerRequestId: requestId,
  };
}
