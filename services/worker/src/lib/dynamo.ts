/**
 * Worker-local wrappers that bind the shared jobs-store helpers to
 * this service's config. Handlers keep using `getJob`, `updateJob`,
 * etc. without threading ctx everywhere.
 */
import {
  getJob as sharedGetJob,
  updateJob as sharedUpdateJob,
  incrementAttempts as sharedIncrementAttempts,
  type JobsStoreContext,
  type UpdateJobAttrs,
} from '@aptlyable/shared';
import { config } from './config';

const ctx: JobsStoreContext = {
  region: config.region,
  tableName: config.jobsTableName,
};

export const getJob = (jobId: string) => sharedGetJob(ctx, jobId);
export const updateJob = (jobId: string, attrs: UpdateJobAttrs) =>
  sharedUpdateJob(ctx, jobId, attrs);
export const incrementAttempts = (jobId: string) => sharedIncrementAttempts(ctx, jobId);

export type { UpdateJobAttrs };
