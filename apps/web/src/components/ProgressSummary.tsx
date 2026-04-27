import type { Job } from '@/types/jobs';
import type { UploadQueueCounts } from '@/hooks/useUploadQueue';

interface Props {
  uploadCounts: UploadQueueCounts;
  jobs: Job[];
}

interface Counts {
  selected: number;
  uploading: number;
  uploaded: number;
  queued: number;
  transcribing: number;
  completed: number;
  failed: number;
}

function computeCounts(uploadCounts: UploadQueueCounts, jobs: Job[]): Counts {
  const counts: Counts = {
    selected: uploadCounts.selected,
    uploading: uploadCounts.uploading,
    uploaded: uploadCounts.uploaded,
    queued: 0,
    transcribing: 0,
    completed: 0,
    failed: uploadCounts.failed,
  };

  for (const job of jobs) {
    if (job.status === 'queued') counts.queued++;
    else if (job.status === 'transcribing') counts.transcribing++;
    else if (job.status === 'completed') counts.completed++;
    else if (job.status === 'failed') counts.failed++;
  }

  return counts;
}

export function ProgressSummary({ uploadCounts, jobs }: Props) {
  const c = computeCounts(uploadCounts, jobs);
  const cards: Array<{ label: string; value: number; tone: string }> = [
    { label: 'Selected', value: c.selected, tone: 'bg-slate-100 text-slate-700' },
    { label: 'Uploading', value: c.uploading, tone: 'bg-blue-50 text-blue-700' },
    { label: 'Uploaded', value: c.uploaded, tone: 'bg-blue-50 text-blue-700' },
    { label: 'Queued', value: c.queued, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Transcribing', value: c.transcribing, tone: 'bg-indigo-50 text-indigo-700' },
    { label: 'Completed', value: c.completed, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Failed', value: c.failed, tone: 'bg-rose-50 text-rose-700' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {cards.map((card) => (
        <div key={card.label} className={`rounded-lg p-3 ${card.tone}`}>
          <div className="text-xs font-medium uppercase tracking-wider opacity-80">
            {card.label}
          </div>
          <div className="mt-1 text-2xl font-semibold">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
