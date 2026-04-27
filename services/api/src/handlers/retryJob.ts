import { ok, conflict, wrap } from '../lib/response';
import { getJobOrFail } from '../lib/handler-utils';
import { updateJob } from '../lib/dynamo';
import { enqueueJob } from '../lib/sqs';
import { config } from '../lib/config';

export const handler = wrap(async (event) => {
  const r = await getJobOrFail(event);
  if (r.kind === 'response') return r.response;
  const job = r.job;

  if (job.status !== 'failed') {
    return conflict(`Only failed jobs can be retried (current status: ${job.status}).`, event);
  }

  const now = new Date().toISOString();
  // Preserve attempts so we can see retry history; the worker bumps it
  // again each time it picks the message up.
  await updateJob(job.jobId, {
    status: 'queued',
    queuedAt: now,
    errorMessage: undefined,
    failedAt: undefined,
  });

  await enqueueJob({
    jobId: job.jobId,
    bucket: config.bucketName,
    s3Key: job.uploadS3Key,
    fileName: job.fileName,
    // Preserve the originally chosen provider on retry.
    provider: job.provider,
  });

  return ok({ jobId: job.jobId, status: 'queued' }, event);
});
