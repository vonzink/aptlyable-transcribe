import type { JobStatus } from '@/types/jobs';

const styles: Record<JobStatus, string> = {
  pending_upload: 'bg-slate-100 text-slate-700 ring-slate-200',
  uploaded: 'bg-blue-50 text-blue-700 ring-blue-200',
  queued: 'bg-amber-50 text-amber-700 ring-amber-200',
  transcribing: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const labels: Record<JobStatus, string> = {
  pending_upload: 'Pending upload',
  uploaded: 'Uploaded',
  queued: 'Queued',
  transcribing: 'Transcribing',
  completed: 'Completed',
  failed: 'Failed',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
      aria-label={`Status: ${labels[status]}`}
    >
      {labels[status]}
    </span>
  );
}
