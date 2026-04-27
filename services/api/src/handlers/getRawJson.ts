import { ok, conflict, wrap } from '../lib/response';
import { getJobOrFail } from '../lib/handler-utils';
import { presignGet } from '../lib/s3';

interface RawJsonResponse {
  jobId: string;
  downloadUrl: string;
}

export const handler = wrap(async (event) => {
  const r = await getJobOrFail(event);
  if (r.kind === 'response') return r.response;
  const job = r.job;

  if (!job.rawJsonKey) {
    return conflict(`Raw provider JSON not available (status=${job.status}).`, event);
  }

  const downloadUrl = await presignGet(job.rawJsonKey);
  const response: RawJsonResponse = { jobId: job.jobId, downloadUrl };
  return ok(response, event);
});
