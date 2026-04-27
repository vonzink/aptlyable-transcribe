import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDdbDocClient } from './clients';
import type { JobRecord, JobStatus } from '../types/job';
import type { TranscriptionProviderName } from '../types/provider';

export interface JobsStoreContext {
  region: string;
  tableName: string;
  /** Name of the GSI used for status-based queries. */
  statusIndexName?: string;
  /** Name of the GSI used for Twilio idempotency lookups. */
  twilioRecordingSidIndexName?: string;
}

/** Anything updateable on a job record in a single Update call. */
export interface UpdateJobAttrs {
  status?: JobStatus;
  uploadedAt?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  errorMessage?: string;
  attempts?: number;
  durationSeconds?: number;
  wordCount?: number;
  providerRequestId?: string;
  transcriptTextKey?: string;
  rawJsonKey?: string;
  provider?: TranscriptionProviderName;
}

export interface ListJobsParams {
  status?: JobStatus;
  limit?: number;
  cursor?: string;
}

export interface ListJobsResult {
  items: JobRecord[];
  cursor?: string;
}

export async function putJob(ctx: JobsStoreContext, job: JobRecord): Promise<void> {
  await getDdbDocClient(ctx.region).send(
    new PutCommand({ TableName: ctx.tableName, Item: job }),
  );
}

export async function getJob(
  ctx: JobsStoreContext,
  jobId: string,
): Promise<JobRecord | undefined> {
  const out = await getDdbDocClient(ctx.region).send(
    new GetCommand({ TableName: ctx.tableName, Key: { jobId } }),
  );
  return out.Item as JobRecord | undefined;
}

export async function updateJob(
  ctx: JobsStoreContext,
  jobId: string,
  attrs: UpdateJobAttrs,
): Promise<JobRecord | undefined> {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    const nameKey = `#${key}`;
    const valueKey = `:${key}`;
    names[nameKey] = key;
    values[valueKey] = value;
    sets.push(`${nameKey} = ${valueKey}`);
  }

  if (sets.length === 0) return getJob(ctx, jobId);

  const out = await getDdbDocClient(ctx.region).send(
    new UpdateCommand({
      TableName: ctx.tableName,
      Key: { jobId },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return out.Attributes as JobRecord | undefined;
}

/**
 * Atomically increment attempts. Used at the start of each transcription
 * try so the count reflects worker pickups, including retries.
 */
export async function incrementAttempts(
  ctx: JobsStoreContext,
  jobId: string,
): Promise<number | undefined> {
  const out = await getDdbDocClient(ctx.region).send(
    new UpdateCommand({
      TableName: ctx.tableName,
      Key: { jobId },
      UpdateExpression: 'ADD #a :one',
      ExpressionAttributeNames: { '#a': 'attempts' },
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'ALL_NEW',
    }),
  );
  const attrs = out.Attributes as JobRecord | undefined;
  return attrs?.attempts;
}

/**
 * List jobs.
 * - If status is given, query the GSI (status, createdAt desc).
 * - Otherwise scan the table (fine for MVP; revisit for >10k rows).
 */
export async function listJobs(
  ctx: JobsStoreContext,
  params: ListJobsParams,
): Promise<ListJobsResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const startKey = params.cursor ? decodeCursor(params.cursor) : undefined;

  if (params.status) {
    const indexName =
      ctx.statusIndexName ?? 'status-createdAt-index';
    const out = await getDdbDocClient(ctx.region).send(
      new QueryCommand({
        TableName: ctx.tableName,
        IndexName: indexName,
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': params.status },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    return {
      items: (out.Items ?? []) as JobRecord[],
      cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
    };
  }

  const out = await getDdbDocClient(ctx.region).send(
    new ScanCommand({
      TableName: ctx.tableName,
      Limit: limit,
      ExclusiveStartKey: startKey,
    }),
  );

  const items = (out.Items ?? []) as JobRecord[];
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return {
    items,
    cursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : undefined,
  };
}

/**
 * Look up a job by Twilio RecordingSid via the dedicated GSI. O(1) — the
 * GSI is keyed on the promoted top-level `twilioRecordingSid` attribute.
 */
export async function findJobByTwilioRecordingSid(
  ctx: JobsStoreContext,
  recordingSid: string,
): Promise<JobRecord | undefined> {
  const indexName =
    ctx.twilioRecordingSidIndexName ?? 'twilio-recording-sid-index';
  const out = await getDdbDocClient(ctx.region).send(
    new QueryCommand({
      TableName: ctx.tableName,
      IndexName: indexName,
      KeyConditionExpression: '#sid = :sid',
      ExpressionAttributeNames: { '#sid': 'twilioRecordingSid' },
      ExpressionAttributeValues: { ':sid': recordingSid },
      Limit: 1,
    }),
  );
  return (out.Items?.[0] as JobRecord | undefined) ?? undefined;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    return undefined;
  }
}
