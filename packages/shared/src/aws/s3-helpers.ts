import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { getS3Client } from './clients';

export interface S3Context {
  region: string;
  bucket: string;
}

export async function presignPut(
  ctx: S3Context,
  params: { key: string; contentType: string; expiresInSeconds: number },
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: ctx.bucket,
    Key: params.key,
    ContentType: params.contentType,
  });
  return getSignedUrl(getS3Client(ctx.region), command, {
    expiresIn: params.expiresInSeconds,
  });
}

export async function presignGet(
  ctx: S3Context,
  key: string,
  expiresInSeconds: number,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: ctx.bucket, Key: key });
  return getSignedUrl(getS3Client(ctx.region), command, {
    expiresIn: expiresInSeconds,
  });
}

export async function objectExists(ctx: S3Context, key: string): Promise<boolean> {
  try {
    await getS3Client(ctx.region).send(
      new HeadObjectCommand({ Bucket: ctx.bucket, Key: key }),
    );
    return true;
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    if (code === 'NotFound' || status === 404) return false;
    throw err;
  }
}

export async function putBytes(
  ctx: S3Context,
  params: {
    key: string;
    body: Buffer | Uint8Array | Readable | string;
    contentType: string;
  },
): Promise<void> {
  await getS3Client(ctx.region).send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
}

export async function putText(
  ctx: S3Context,
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  await putBytes(ctx, { key, body, contentType });
}

export async function getObjectText(ctx: S3Context, key: string): Promise<string> {
  const out = await getS3Client(ctx.region).send(
    new GetObjectCommand({ Bucket: ctx.bucket, Key: key }),
  );
  const body = out.Body as { transformToString?: () => Promise<string> } | undefined;
  if (!body || typeof body.transformToString !== 'function') {
    throw new Error('Unexpected S3 response body shape.');
  }
  return body.transformToString();
}
