import { request } from 'undici';
import { countWords } from '@aptlyable/shared';
import { config } from '../lib/config';
import { getProviderApiKey } from '../lib/secrets';
import {
  type TranscribeInput,
  type TranscriptionProvider,
  type TranscriptionResult,
  NonRetryableTranscriptionError,
} from './types';

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  speaker?: number;
}

interface DeepgramSentence {
  text?: string;
  start?: number;
  end?: number;
}

interface DeepgramParagraph {
  speaker?: number;
  start?: number;
  end?: number;
  num_words?: number;
  sentences?: DeepgramSentence[];
}

interface DeepgramAlternative {
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
  paragraphs?: {
    transcript?: string;
    paragraphs?: DeepgramParagraph[];
  };
}

interface DeepgramChannel {
  alternatives?: DeepgramAlternative[];
}

interface DeepgramUtterance {
  speaker?: number;
  start?: number;
  end?: number;
  transcript?: string;
  confidence?: number;
}

export interface DeepgramResponse {
  metadata?: {
    request_id?: string;
    duration?: number;
    channels?: number;
  };
  results?: {
    channels?: DeepgramChannel[];
    utterances?: DeepgramUtterance[];
  };
}

export class DeepgramProvider implements TranscriptionProvider {
  readonly name = 'deepgram' as const;

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const apiKey = await getProviderApiKey('deepgram');

    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', config.deepgramModel);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('diarize', 'true');
    url.searchParams.set('paragraphs', 'true');
    url.searchParams.set('utterances', 'true');
    url.searchParams.set('detect_language', 'false');
    url.searchParams.set('language', config.deepgramLanguage);

    const res = await request(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: input.signedAudioUrl }),
      bodyTimeout: config.sqsVisibilityTimeoutSeconds * 1000,
      headersTimeout: 60_000,
    });

    const status = res.statusCode;
    const text = await res.body.text();

    if (status < 200 || status >= 300) {
      // 4xx (except 408/429) are typically caused by bad input — don't retry.
      const retryable = status === 408 || status === 429 || status >= 500;
      const message = `Deepgram request failed (${status}): ${text.slice(0, 500)}`;
      if (!retryable) throw new NonRetryableTranscriptionError(message);
      throw new Error(message);
    }

    let parsed: DeepgramResponse;
    try {
      parsed = JSON.parse(text) as DeepgramResponse;
    } catch (err) {
      throw new Error(
        `Deepgram returned non-JSON 2xx response: ${(err as Error).message}`,
      );
    }

    return formatDeepgramResponse(parsed);
  }
}

/**
 * Convert a Deepgram prerecorded response into a normalized result.
 *
 * Preference order (richest → poorest):
 *   1) results.utterances           — line-per-speaker-turn
 *   2) results.channels[0].alternatives[0].paragraphs.paragraphs
 *   3) results.channels[0].alternatives[0].transcript
 */
export function formatDeepgramResponse(resp: DeepgramResponse): TranscriptionResult {
  const requestId = resp.metadata?.request_id;
  const durationSeconds = resp.metadata?.duration;

  const utterances = resp.results?.utterances ?? [];
  if (utterances.length > 0) {
    return {
      text: formatUtterances(utterances),
      rawJson: resp,
      wordCount: countWords(utterances.map((u) => u.transcript ?? '').join(' ')),
      durationSeconds,
      providerRequestId: requestId,
    };
  }

  const alt = resp.results?.channels?.[0]?.alternatives?.[0];
  const paragraphs = alt?.paragraphs?.paragraphs ?? [];
  if (paragraphs.length > 0) {
    return {
      text: formatParagraphs(paragraphs),
      rawJson: resp,
      wordCount: countWords(
        paragraphs
          .flatMap((p) => p.sentences ?? [])
          .map((s) => s.text ?? '')
          .join(' '),
      ),
      durationSeconds,
      providerRequestId: requestId,
    };
  }

  const transcript = alt?.transcript ?? '';
  return {
    text: transcript.trim(),
    rawJson: resp,
    wordCount: countWords(transcript),
    durationSeconds,
    providerRequestId: requestId,
  };
}

function formatUtterances(utterances: DeepgramUtterance[]): string {
  const lines: string[] = [];
  let lastSpeaker: number | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const prefix = lastSpeaker !== undefined ? `Speaker ${lastSpeaker}: ` : '';
    lines.push(`${prefix}${buffer.join(' ')}`);
    buffer = [];
  };

  for (const u of utterances) {
    const text = (u.transcript ?? '').trim();
    if (!text) continue;
    if (u.speaker !== lastSpeaker) {
      flush();
      lastSpeaker = u.speaker;
    }
    buffer.push(text);
  }
  flush();

  return lines.join('\n\n').trim();
}

function formatParagraphs(paragraphs: DeepgramParagraph[]): string {
  const lines: string[] = [];
  for (const p of paragraphs) {
    const text = (p.sentences ?? [])
      .map((s) => (s.text ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (!text) continue;
    const prefix = p.speaker !== undefined ? `Speaker ${p.speaker}: ` : '';
    lines.push(`${prefix}${text}`);
  }
  return lines.join('\n\n').trim();
}

