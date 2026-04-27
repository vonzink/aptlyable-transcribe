import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { isValidTwilioSignature, parseFormBody } from '../src/lib/twilio';

// Helper: produce the signature exactly as Twilio would, using the
// algorithm in the official docs.
function sign(authToken: string, url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const k of sorted) data += k + params[k];
  return createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
}

const AUTH_TOKEN = 'test-auth-token-deadbeef';
const URL = 'https://api.example.com/api/twilio/recording-callback?provider=deepgram';

test('parseFormBody decodes a typical Twilio recording-callback body', () => {
  const body =
    'AccountSid=AC123&CallSid=CA456&RecordingSid=RE789' +
    '&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2F2010-04-01%2FAccounts%2FAC123%2FRecordings%2FRE789' +
    '&RecordingStatus=completed&RecordingDuration=42&From=%2B15555550100&To=%2B15555550199';

  const parsed = parseFormBody(body);
  assert.equal(parsed.AccountSid, 'AC123');
  assert.equal(parsed.CallSid, 'CA456');
  assert.equal(parsed.RecordingSid, 'RE789');
  assert.equal(
    parsed.RecordingUrl,
    'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE789',
  );
  assert.equal(parsed.RecordingStatus, 'completed');
  assert.equal(parsed.RecordingDuration, '42');
  assert.equal(parsed.From, '+15555550100');
  assert.equal(parsed.To, '+15555550199');
});

test('isValidTwilioSignature accepts a correct signature', () => {
  const params = {
    AccountSid: 'AC123',
    CallSid: 'CA456',
    RecordingSid: 'RE789',
    RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE789',
    RecordingStatus: 'completed',
  };
  const signature = sign(AUTH_TOKEN, URL, params);

  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      url: URL,
      params,
      signatureHeader: signature,
    }),
    true,
  );
});

test('isValidTwilioSignature rejects a tampered body', () => {
  const params = { AccountSid: 'AC123', RecordingSid: 'RE789' };
  const signature = sign(AUTH_TOKEN, URL, params);

  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      url: URL,
      params: { ...params, RecordingSid: 'RE-TAMPERED' },
      signatureHeader: signature,
    }),
    false,
  );
});

test('isValidTwilioSignature rejects a wrong auth token', () => {
  const params = { AccountSid: 'AC123', RecordingSid: 'RE789' };
  const signature = sign(AUTH_TOKEN, URL, params);

  assert.equal(
    isValidTwilioSignature({
      authToken: 'different-token',
      url: URL,
      params,
      signatureHeader: signature,
    }),
    false,
  );
});

test('isValidTwilioSignature rejects an empty signature header', () => {
  const params = { AccountSid: 'AC123' };
  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      url: URL,
      params,
      signatureHeader: '',
    }),
    false,
  );
});

test('isValidTwilioSignature is sensitive to URL changes (incl. query string)', () => {
  const params = { AccountSid: 'AC123' };
  const signature = sign(AUTH_TOKEN, URL, params);

  assert.equal(
    isValidTwilioSignature({
      authToken: AUTH_TOKEN,
      url: URL.replace('provider=deepgram', 'provider=openai'),
      params,
      signatureHeader: signature,
    }),
    false,
  );
});
