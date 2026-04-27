import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ok, badRequest, parseJsonBody, wrap } from '../lib/response';
import { CompleteUploadsSchema } from '../lib/validation';
import { getJob, updateJob } from '../lib/dynamo';
import { objectExists } from '../lib/s3';
import { enqueueJob } from '../lib/sqs';
import { config } from '../lib/config';

interface JobOutcome {
  jobId: string;
  status: 'queued' | 'failed' | 'already_completed' | 'not_found' | 'missing_object' | 'invalid_state';
  message?: string;
}

interface CompleteUploadsResponse {
  results: JobOutcome[];
}

export const handler = wrap(async (event, requestLog) => {
  const body = parseJsonBody(event);
  const parsed = CompleteUploadsSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest('Invalid request body.', parsed.error.flatten(), event);
  }

  const results: JobOutcome[] = [];

  for (const jobId of parsed.data.jobIds) {
    const job = await getJob(jobId);
    if (!job) {
      results.push({ jobId, status: 'not_found' });
      continue;
    }

    if (job.status === 'completed') {
      results.push({ jobId, status: 'already_completed' });
      continue;
    }

    // Only "pending_upload" jobs are valid completion targets. Anything else
    // means the client raced or replayed.
    if (job.status !== 'pending_upload') {
      results.push({
        jobId,
        status: 'invalid_state',
        message: `Job is in status "${job.status}", expected "pending_upload".`,
      });
      continue;
    }

    // Verify the S3 object actually exists. Avoids enqueuing ghosts.
    const exists = await objectExists(job.uploadS3Key);
    if (!exists) {
      results.push({
        jobId,
        status: 'missing_object',
        message: 'Uploaded S3 object not found yet.',
      });
      continue;
    }

    const now = new Date().toISOString();
    await updateJob(jobId, {
      status: 'queued',
      uploadedAt: now,
      queuedAt: now,
    });

    try {
      await enqueueJob({
        jobId,
        bucket: config.bucketName,
        s3Key: job.uploadS3Key,
        fileName: job.fileName,
        provider: job.provider,
      });
      results.push({ jobId, status: 'queued' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enqueue.';
      await updateJob(jobId, { status: 'failed', failedAt: now, errorMessage: message });
      results.push({ jobId, status: 'failed', message });
    }
  }

  const response: CompleteUploadsResponse = { results };
  requestLog.info('completeUploads', {
    total: parsed.data.jobIds.length,
    queued: results.filter((r) => r.status === 'queued').length,
    failed: results.filter((r) => r.status === 'failed').length,
  });

  return ok(response, event);
});
