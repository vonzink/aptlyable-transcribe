import { createHmac, timingSafeEqual } from 'node:crypto';
import { request } from 'undici';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { config } from './config';

const sm = new SecretsManagerClient({ region: config.region });
let cachedToken: string | undefined;

/**
 * Fetch (and cache) the Twilio auth token. Cold-start path only —
 * once cached, the Lambda reuses it across invocations within the
 * container's lifetime.
 */
export async function getTwilioAuthToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const out = await sm.send(new GetSecretValueCommand({ SecretId: config.twilioSecretName }));
  const value = out.SecretString ?? '';
  if (!value || value === 'REPLACE_ME_AFTER_DEPLOY') {
    throw new Error(
      `Twilio secret "${config.twilioSecretName}" is unset or still placeholder. ` +
        `Run scripts/create-secret.sh twilio <auth_token>.`,
    );
  }
  cachedToken = value;
  return value;
}

/**
 * Verify a Twilio webhook signature.
 *
 * Algorithm (https://www.twilio.com/docs/usage/webhooks/webhooks-security):
 *   1. Take the full webhook URL (incl. query string).
 *   2. Sort POST params alphabetically by key.
 *   3. Append `${key}${value}` for each (no separators, no encoding).
 *   4. HMAC-SHA1 with the auth token, base64-encode.
 *   5. Compare (constant-time) with the X-Twilio-Signature header.
 *
 * For application/x-www-form-urlencoded webhooks (Twilio's default),
 * `params` is the parsed body. For application/json (rare here), the
 * raw body is hashed instead — we don't support that path; Twilio's
 * recordingStatusCallback always sends form-urlencoded.
 */
export function isValidTwilioSignature(opts: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signatureHeader: string;
}): boolean {
  const { authToken, url, params, signatureHeader } = opts;
  if (!signatureHeader) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) {
    data += k + params[k];
  }

  const expected = createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Decode an application/x-www-form-urlencoded body into a flat
 * key→value map. Twilio sends only single-valued params on
 * recordingStatusCallback, so we keep the last seen value if a key
 * repeats (defensive).
 */
export function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = pair.split('=');
    if (!rawKey) continue;
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    out[key] = value;
  }
  return out;
}

/**
 * Download a Twilio recording as MP3 bytes. The Recording REST API
 * accepts an `.mp3` extension on the resource URL; auth is HTTP Basic
 * with the account SID + auth token.
 *
 * Twilio recordings for typical 3–10 minute calls are a few MB — we
 * buffer in memory rather than streaming to /tmp. Caller bounds size
 * via Lambda memory + the 5xx timeout.
 */
export async function downloadTwilioRecording(opts: {
  accountSid: string;
  recordingUrl: string;
  authToken: string;
}): Promise<Buffer> {
  const url = ensureMp3Extension(opts.recordingUrl);
  const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');

  const res = await request(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
    headersTimeout: 60_000,
    bodyTimeout: 5 * 60_000,
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const detail = await res.body.text();
    throw new Error(
      `Twilio recording download failed (${res.statusCode}): ${detail.slice(0, 300)}`,
    );
  }

  const buf = Buffer.from(await res.body.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error('Twilio recording download returned 0 bytes.');
  }
  return buf;
}

function ensureMp3Extension(url: string): string {
  // Strip query, append .mp3 if missing, re-append query.
  const [pathPart, queryPart] = url.split('?', 2);
  const withExt = /\.mp3$/i.test(pathPart) ? pathPart : `${pathPart}.mp3`;
  return queryPart ? `${withExt}?${queryPart}` : withExt;
}
