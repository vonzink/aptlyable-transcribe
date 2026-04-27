import { v4 as uuid } from 'uuid';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ok, badRequest, parseJsonBody, wrap } from '../lib/response';
import {
  CreateUploadsSchema,
  resolveProvider,
  sanitizeFileName,
  validateFile,
} from '../lib/validation';
import { putJob } from '../lib/dynamo';
import { presignPut, uploadKey } from '../lib/s3';
import { config } from '../lib/config';
import type { JobRecord, TranscriptionProviderName } from '../types/job';

interface UploadEntry {
  jobId: string;
  fileName: string;
  uploadUrl: string;
  s3Key: string;
  provider: TranscriptionProviderName;
  /** Echo of the client-supplied id (if any) — frontend uses it to match rows. */
  clientId?: string;
}

interface RejectionEntry {
  fileName: string;
  reason: string;
  /** Echo of the client-supplied id so rejections also match cleanly. */
  clientId?: string;
}

interface CreateUploadsResponse {
  uploads: UploadEntry[];
  rejected: RejectionEntry[];
}

export const handler = wrap(async (event, requestLog) => {
  const body = parseJsonBody(event);
  const parsed = CreateUploadsSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Invalid request body.', parsed.error.flatten(), event);
  }

  const uploads: UploadEntry[] = [];
  const rejected: RejectionEntry[] = [];
  const now = new Date().toISOString();

  for (const file of parsed.data.files) {
    const provider = resolveProvider(file.provider, parsed.data.provider);
    const validation = validateFile(file, provider);
    if (!validation.ok) {
      rejected.push({
        fileName: file.fileName,
        reason: validation.reason ?? 'Invalid file.',
        clientId: file.clientId,
      });
      continue;
    }

    const jobId = uuid();
    const safeName = sanitizeFileName(file.fileName);
    const key = uploadKey(jobId, safeName);

    const job: JobRecord = {
      jobId,
      fileName: safeName,
      originalFileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      status: 'pending_upload',
      provider,
      uploadS3Key: key,
      createdAt: now,
      attempts: 0,
    };

    await putJob(job);
    const uploadUrl = await presignPut({ key, contentType: file.contentType });

    uploads.push({
      jobId,
      fileName: safeName,
      uploadUrl,
      s3Key: key,
      provider,
      clientId: file.clientId,
    });
  }

  const response: CreateUploadsResponse = { uploads, rejected };

  requestLog.info('createUploads', {
    requested: parsed.data.files.length,
    accepted: uploads.length,
    rejected: rejected.length,
    bucket: config.bucketName,
  });

  return ok(response, event);
});
