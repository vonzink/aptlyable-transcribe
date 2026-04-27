/**
 * Worker-local S3 wrappers bound to this service's config. Re-exports
 * key builders + provides a presign helper for the audio file the
 * provider downloads.
 */
import {
  presignGet as sharedPresignGet,
  putBytes as sharedPutBytes,
  putText as sharedPutText,
  type S3Context,
} from '@aptlyable/shared';
import { config } from './config';

const ctx: S3Context = { region: config.region, bucket: config.bucketName };

/**
 * Short-lived presigned GET URL handed to a provider. Visibility
 * timeout of the SQS message is much longer than this URL — the URL
 * only needs to live long enough for the provider to download.
 */
export const presignAudioGet = (s3Key: string) =>
  sharedPresignGet(ctx, s3Key, config.presignedDownloadExpiresSeconds);

export const putBytes = (params: { key: string; body: Buffer | Uint8Array | string; contentType: string }) =>
  sharedPutBytes(ctx, params);

export const putText = (key: string, body: string, contentType: string) =>
  sharedPutText(ctx, key, body, contentType);

// Key builders are pure — re-export from shared.
export { transcriptTextKey, rawJsonKey } from '@aptlyable/shared';
