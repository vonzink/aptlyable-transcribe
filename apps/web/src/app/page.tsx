'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DropzoneUploader } from '@/components/DropzoneUploader';
import { JobsTable } from '@/components/JobsTable';
import { ProgressSummary } from '@/components/ProgressSummary';
import { StatusBadge } from '@/components/StatusBadge';
import { TranscriptViewer } from '@/components/TranscriptViewer';
import { api } from '@/lib/api';
import type { Job, TranscriptionProvider } from '@/types/jobs';
import { useUploadQueue } from '@/hooks/useUploadQueue';

const POLL_INTERVAL_MS = 4_000;

export default function HomePage() {
  const [provider, setProvider] = useState<TranscriptionProvider>('deepgram');
  const uploadQueue = useUploadQueue(provider);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await api.listJobs({ limit: 200 });
      setJobs(res.items);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Polling: only while there are active jobs.
  useEffect(() => {
    const hasActive = jobs.some(
      (j) => j.status === 'queued' || j.status === 'transcribing' || j.status === 'uploaded',
    );

    if (!hasActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (intervalRef.current) return;

    intervalRef.current = setInterval(() => {
      void fetchJobs();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [jobs, fetchJobs]);

  const onJobsCreated = useCallback(() => {
    void fetchJobs();
  }, [fetchJobs]);

  const onRetry = useCallback(
    async (job: Job) => {
      try {
        await api.retryJob(job.jobId);
        await fetchJobs();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to retry job.');
      }
    },
    [fetchJobs],
  );

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          AptlyAble Bulk Transcriber
        </h1>
        <p className="text-sm text-slate-600">
          Drag and drop MP3 or MP4 files. Pick an engine — Deepgram Nova-3, OpenAI gpt-4o-transcribe, or AssemblyAI Universal-2.
        </p>
      </header>

      <DropzoneUploader
        provider={provider}
        onProviderChange={setProvider}
        queue={uploadQueue}
        onJobsCreated={onJobsCreated}
      />

      <ProgressSummary uploadCounts={uploadQueue.counts} jobs={jobs} />

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700" role="alert">
          {error}
        </div>
      )}

      <section aria-labelledby="jobs-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="jobs-heading" className="text-lg font-semibold text-slate-900">
            Jobs
          </h2>
          <div className="flex items-center gap-2">
            {isLoading && <span className="text-xs text-slate-500">Loading…</span>}
            <button
              type="button"
              onClick={() => void fetchJobs()}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <JobsTable
          jobs={jobs}
          onView={(job) => setActiveJob(job)}
          onRetry={(job) => void onRetry(job)}
        />

        {jobs.length > 0 && (
          <p className="text-xs text-slate-500">
            Showing {jobs.length} jobs.{' '}
            <span className="inline-flex items-center gap-1">Status legend:</span>
            {(['pending_upload', 'uploaded', 'queued', 'transcribing', 'completed', 'failed'] as const).map((s) => (
              <span key={s} className="ml-2 inline-flex">
                <StatusBadge status={s} />
              </span>
            ))}
          </p>
        )}
      </section>

      {activeJob && <TranscriptViewer job={activeJob} onClose={() => setActiveJob(null)} />}
    </main>
  );
}
