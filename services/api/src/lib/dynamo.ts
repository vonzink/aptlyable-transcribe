/**
 * API-local wrappers that bind the shared jobs-store helpers to this
 * service's config. Handlers continue calling `getJob`, `updateJob`,
 * etc. without threading ctx everywhere.
 */
import {
  putJob as sharedPutJob,
  getJob as sharedGetJob,
  updateJob as sharedUpdateJob,
  listJobs as sharedListJobs,
  findJobByTwilioRecordingSid as sharedFindByTwilioSid,
  type JobRecord,
  type JobsStoreContext,
  type UpdateJobAttrs,
  type ListJobsParams,
  type ListJobsResult,
} from '@aptlyable/shared';
import { config } from './config';

const ctx: JobsStoreContext = {
  region: config.region,
  tableName: config.jobsTableName,
  statusIndexName: config.jobsTableStatusIndex,
  twilioRecordingSidIndexName: config.jobsTableTwilioIndex,
};

export const putJob = (job: JobRecord) => sharedPutJob(ctx, job);
export const getJob = (jobId: string) => sharedGetJob(ctx, jobId);
export const updateJob = (jobId: string, attrs: UpdateJobAttrs) =>
  sharedUpdateJob(ctx, jobId, attrs);
export const listJobs = (params: ListJobsParams) => sharedListJobs(ctx, params);
export const findJobByTwilioRecordingSid = (sid: string) =>
  sharedFindByTwilioSid(ctx, sid);

export type { UpdateJobAttrs, ListJobsParams, ListJobsResult };
