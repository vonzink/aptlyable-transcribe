'use client';

import { useEffect, useState } from 'react';
import type { Job, TranscriptResponse } from '@/types/jobs';
import { PROVIDER_LABEL } from '@/lib/providerDisplay';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/formatters';

interface Props {
  job: Job;
  onClose: () => void;
}

export function TranscriptViewer({ job, onClose }: Props) {
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    api.getTranscript(job.jobId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load transcript.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.jobId]);

  const onCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const onDownloadTxt = () => {
    if (!data) return;
    const blob = new Blob([data.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${job.fileName.replace(/\.(mp3|mp4)$/i, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDownloadJson = async () => {
    try {
      const { downloadUrl } = await api.getRawJson(job.jobId);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch raw JSON.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Transcript for ${job.fileName}`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900" title={job.originalFileName ?? job.fileName}>
              {job.originalFileName ?? job.fileName}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {job.provider ? `${PROVIDER_LABEL[job.provider]} · ` : ''}
              {data?.wordCount ?? job.wordCount ?? '—'} words · {formatDuration(data?.durationSeconds ?? job.durationSeconds)}
              {job.providerRequestId ? ` · req ${job.providerRequestId}` : ''}
            </p>
            {job.source === 'twilio' && job.twilio && (
              <p className="mt-1 text-xs text-violet-700">
                Twilio recording {job.twilio.recordingSid}
                {job.twilio.from ? ` · from ${job.twilio.from}` : ''}
                {job.twilio.to ? ` → ${job.twilio.to}` : ''}
                {job.twilio.callSid ? ` · call ${job.twilio.callSid}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm">
          <button
            type="button"
            onClick={onCopy}
            disabled={!data}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? 'Copied!' : 'Copy text'}
          </button>
          <button
            type="button"
            onClick={onDownloadTxt}
            disabled={!data}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download .txt
          </button>
          <button
            type="button"
            onClick={onDownloadJson}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download raw .json
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {isLoading && <div className="text-sm text-slate-500">Loading transcript…</div>}
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </div>
          )}
          {data && (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
              {data.text || '(empty transcript)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
