/**
 * API-local S3 wrappers bound to this service's config.
 */
import {
  presignPut as sharedPresignPut,
  presignGet as sharedPresignGet,
  putBytes as sharedPutBytes,
  getObjectText as sharedGetObjectText,
  objectExists as sharedObjectExists,
  uploadKey,
  type S3Context,
} from '@aptlyable/shared';
import { config } from './config';

const ctx: S3Context = { region: config.region, bucket: config.bucketName };

export const presignPut = (params: { key: string; contentType: string }) =>
  sharedPresignPut(ctx, { ...params, expiresInSeconds: config.uploadUrlTtlSeconds });

export const presignGet = (key: string) =>
  sharedPresignGet(ctx, key, config.downloadUrlTtlSeconds);

export const putBytes = (params: { key: string; body: Buffer | Uint8Array | string; contentType: string }) =>
  sharedPutBytes(ctx, params);

export const objectExists = (key: string) => sharedObjectExists(ctx, key);

export const getObjectText = (key: string) => sharedGetObjectText(ctx, key);

// Key builder is pure — re-export.
export { uploadKey };
