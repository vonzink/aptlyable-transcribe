'use client';

import type { Job } from '@/types/jobs';
import { PROVIDER_LABEL, SHORT_PROVIDER_LABEL } from '@/lib/providerDisplay';
import { StatusBadge } from './StatusBadge';
import { formatBytes, formatDate, formatDuration } from '@/lib/formatters';

interface Props {
  jobs: Job[];
  onView: (job: Job) => void;
  onRetry: (job: Job) => void;
}

export function JobsTable({ jobs, onView, onRetry }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No jobs yet. Upload some MP3 files above to get started.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">File</th>
              <th scope="col" className="px-4 py-3">Provider</th>
              <th scope="col" className="px-4 py-3">Size</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Uploaded</th>
              <th scope="col" className="px-4 py-3">Started</th>
              <th scope="col" className="px-4 py-3">Completed</th>
              <th scope="col" className="px-4 py-3">Duration</th>
              <th scope="col" className="px-4 py-3">Words</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <tr key={job.jobId} className="hover:bg-slate-50">
                <td className="max-w-xs truncate px-4 py-3 font-medium text-slate-900" title={job.originalFileName ?? job.fileName}>
                  <div className="flex items-center gap-2">
                    {job.source === 'twilio' && (
                      <span
                        className="shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200"
                        title="Ingested from Twilio recording webhook"
                      >
                        Twilio
                      </span>
                    )}
                    <span className="truncate">{job.originalFileName ?? job.fileName}</span>
                  </div>
                  {job.twilio?.from && job.twilio?.to && (
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {job.twilio.from} → {job.twilio.to}
                    </div>
                  )}
                  {job.errorMessage && (
                    <div className="mt-0.5 max-w-md truncate text-xs text-rose-600" title={job.errorMessage}>
                      {job.errorMessage}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600" title={job.provider ? PROVIDER_LABEL[job.provider] : ''}>
                  {job.provider ? SHORT_PROVIDER_LABEL[job.provider] : '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatBytes(job.size)}</td>
                <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                <td className="px-4 py-3 text-slate-600">{formatDate(job.uploadedAt ?? job.createdAt)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(job.startedAt)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(job.completedAt)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDuration(job.durationSeconds)}</td>
                <td className="px-4 py-3 text-slate-600">{job.wordCount ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {job.status === 'completed' && (
                      <button
                        type="button"
                        onClick={() => onView(job)}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        View
                      </button>
                    )}
                    {job.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => onRetry(job)}
                        className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
