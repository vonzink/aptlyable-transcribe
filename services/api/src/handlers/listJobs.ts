import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ok, badRequest, wrap } from '../lib/response';
import { listJobs } from '../lib/dynamo';
import { ALL_STATUSES, type JobStatus } from '../types/job';

export const handler = wrap(async (event: APIGatewayProxyEventV2) => {
  const qs = event.queryStringParameters ?? {};
  const status = qs.status as JobStatus | undefined;
  if (status && !ALL_STATUSES.includes(status)) {
    return badRequest(`Invalid status "${status}".`, { allowed: ALL_STATUSES }, event);
  }

  const limitRaw = qs.limit ? parseInt(qs.limit, 10) : undefined;
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

  const result = await listJobs({ status, limit, cursor: qs.cursor });
  return ok(result, event);
});
