/** Re-export shared job types so existing worker imports still resolve. */
export {
  type JobRecord,
  type JobStatus,
  type JobSource,
  type TwilioJobMeta,
  type TranscriptionProviderName,
  type TranscriptionJobMessage,
  ALL_STATUSES,
  ALL_PROVIDERS,
  isJobStatus,
  isProviderName,
  isTerminal,
  isActive,
} from '@aptlyable/shared';
