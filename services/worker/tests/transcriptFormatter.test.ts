import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDeepgramResponse } from '../src/providers/deepgram';
import { formatOpenAIResponse } from '../src/providers/openai';
import { formatAssemblyAIResponse } from '../src/providers/assemblyai';

// ---------- Deepgram ----------

test('deepgram: prefers utterances and groups consecutive turns by speaker', () => {
  const result = formatDeepgramResponse({
    metadata: { request_id: 'req-1', duration: 12.5 },
    results: {
      utterances: [
        { speaker: 0, transcript: 'Hello there.' },
        { speaker: 0, transcript: 'How are you?' },
        { speaker: 1, transcript: 'I am well.' },
      ],
    },
  });

  assert.equal(result.providerRequestId, 'req-1');
  assert.equal(result.durationSeconds, 12.5);
  assert.match(result.text, /Speaker 0: Hello there\. How are you\?/);
  assert.match(result.text, /Speaker 1: I am well\./);
  // "Hello there. How are you? I am well." → 8 whitespace-delimited tokens.
  assert.equal(result.wordCount, 8);
});

test('deepgram: falls back to paragraphs when utterances are missing', () => {
  const result = formatDeepgramResponse({
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: 'ignored top-level transcript',
              paragraphs: {
                paragraphs: [
                  { speaker: 0, sentences: [{ text: 'First sentence.' }, { text: 'Second sentence.' }] },
                  { speaker: 1, sentences: [{ text: 'Reply.' }] },
                ],
              },
            },
          ],
        },
      ],
    },
  });

  assert.match(result.text, /Speaker 0: First sentence\. Second sentence\./);
  assert.match(result.text, /Speaker 1: Reply\./);
  assert.ok(result.wordCount >= 5);
});

test('deepgram: falls back to plain transcript when nothing structured is available', () => {
  const result = formatDeepgramResponse({
    results: {
      channels: [{ alternatives: [{ transcript: 'just a plain string' }] }],
    },
  });

  assert.equal(result.text, 'just a plain string');
  assert.equal(result.wordCount, 4);
});

test('deepgram: returns empty result for completely empty responses', () => {
  const result = formatDeepgramResponse({});
  assert.equal(result.text, '');
  assert.equal(result.wordCount, 0);
  assert.equal(result.providerRequestId, undefined);
});

// ---------- OpenAI ----------

test('openai: uses verbose_json segments when present', () => {
  const result = formatOpenAIResponse(
    {
      text: 'Whole thing.',
      duration: 5.5,
      segments: [
        { id: 0, text: ' First segment.' },
        { id: 1, text: 'Second segment.' },
      ],
    },
    'req-abc',
  );

  assert.equal(result.providerRequestId, 'req-abc');
  assert.equal(result.durationSeconds, 5.5);
  assert.match(result.text, /First segment\./);
  assert.match(result.text, /Second segment\./);
  assert.equal(result.wordCount, 4);
});

test('openai: falls back to plain text when no segments', () => {
  const result = formatOpenAIResponse({ text: 'one two three', duration: 1 });
  assert.equal(result.text, 'one two three');
  assert.equal(result.wordCount, 3);
});

test('openai: handles empty response', () => {
  const result = formatOpenAIResponse({});
  assert.equal(result.text, '');
  assert.equal(result.wordCount, 0);
});

// ---------- AssemblyAI ----------

test('assemblyai: uses utterances with speaker labels when present', () => {
  const result = formatAssemblyAIResponse({
    id: 'transcript-id-1',
    status: 'completed',
    audio_duration: 30.2,
    utterances: [
      { speaker: 'A', text: 'Good morning.' },
      { speaker: 'B', text: 'Hi there.' },
    ],
  });

  assert.equal(result.providerRequestId, 'transcript-id-1');
  assert.equal(result.durationSeconds, 30.2);
  assert.match(result.text, /Speaker A: Good morning\./);
  assert.match(result.text, /Speaker B: Hi there\./);
});

test('assemblyai: falls back to plain text when no utterances', () => {
  const result = formatAssemblyAIResponse({
    id: 'transcript-id-2',
    status: 'completed',
    text: 'no diarization here',
    utterances: null,
  });
  assert.equal(result.text, 'no diarization here');
  assert.equal(result.wordCount, 3);
});
