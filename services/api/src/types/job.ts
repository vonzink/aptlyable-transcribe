/**
 * Re-export job types from the shared package so handlers can keep
 * importing `../types/job` without each one knowing the shared package
 * exists. Shared is the source of truth.
 */
export {
  type JobRecord,
  type JobStatus,
  type JobSource,
  type TwilioJobMeta,
  type TranscriptionProviderName,
  ALL_STATUSES,
  ALL_PROVIDERS,
  isJobStatus,
  isProviderName,
  isTerminal,
  isActive,
} from '@aptlyable/shared';
