import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { JobRecord } from '@aptlyable/shared';
import { getJob } from './dynamo';
import { badRequest, notFound } from './response';

export type Resolved<T> =
  | { kind: 'ok'; job: T }
  | { kind: 'response'; response: APIGatewayProxyResultV2 };

/**
 * Read a `:jobId` path parameter, fetch the job, and return either
 * `{ kind: 'ok', job }` or a ready-to-return error response. Replaces
 * the four-line preamble that was duplicated across getJob /
 * getTranscript / getRawJson / retryJob.
 *
 * Discriminated union beats throw-and-catch — control flow stays in
 * the handler and TypeScript narrows correctly after a `kind === 'ok'`
 * check.
 */
export async function getJobOrFail(
  event: APIGatewayProxyEventV2,
): Promise<Resolved<JobRecord>> {
  const jobId = event.pathParameters?.jobId;
  if (!jobId) {
    return { kind: 'response', response: badRequest('Missing jobId.', undefined, event) };
  }
  const job = await getJob(jobId);
  if (!job) {
    return { kind: 'response', response: notFound('Job not found.', event) };
  }
  return { kind: 'ok', job };
}
