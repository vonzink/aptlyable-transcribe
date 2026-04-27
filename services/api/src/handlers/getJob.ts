import { ok, wrap } from '../lib/response';
import { getJobOrFail } from '../lib/handler-utils';

export const handler = wrap(async (event) => {
  const r = await getJobOrFail(event);
  if (r.kind === 'response') return r.response;
  return ok(r.job, event);
});
