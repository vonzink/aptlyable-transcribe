'use client';

import { useRef, useState } from 'react';
import type { LocalUpload, TranscriptionProvider } from '@/types/jobs';
import { ProviderSelector } from './ProviderSelector';
import { formatBytes } from '@/lib/formatters';
import type { UseUploadQueueResult } from '@/hooks/useUploadQueue';
import { UPLOAD_LIMITS } from '@/hooks/useUploadQueue';
import { SUPPORTED_MEDIA_ACCEPT, SUPPORTED_MEDIA_LABEL } from '@aptlyable/shared';

interface Props {
  provider: TranscriptionProvider;
  onProviderChange: (provider: TranscriptionProvider) => void;
  queue: UseUploadQueueResult;
  /** Fires once after a successful upload+complete cycle so the page can refetch jobs. */
  onJobsCreated?: () => void;
}

export function DropzoneUploader({ provider, onProviderChange, queue, onJobsCreated }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) queue.enqueue(e.target.files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) queue.enqueue(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    await queue.upload();
    onJobsCreated?.();
  };

  return (
    <section className="space-y-4">
      <ProviderSelector value={provider} onChange={onProviderChange} disabled={queue.isUploading} />

      {queue.openaiOversizePending > 0 && (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          {queue.openaiOversizePending} file{queue.openaiOversizePending === 1 ? '' : 's'} exceed
          OpenAI's 25 MB limit. They'll be rejected at upload — switch to Deepgram or AssemblyAI for
          those.
        </div>
      )}

      <DropzoneArea
        isDragging={isDragging}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        inputRef={inputRef}
        onInputChange={onInputChange}
      />

      {queue.globalError && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
        >
          {queue.globalError}
        </div>
      )}

      {queue.items.length > 0 && (
        <UploadList queue={queue} onUpload={handleUpload} />
      )}
    </section>
  );
}

function DropzoneArea({
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  inputRef,
  onInputChange,
}: {
  isDragging: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Drag and drop ${SUPPORTED_MEDIA_LABEL} files or click to browse`}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        isDragging
          ? 'border-brand-500 bg-brand-50'
          : 'border-slate-300 bg-white hover:border-brand-500'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_MEDIA_ACCEPT}
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      <div className="text-lg font-medium text-slate-700">
        Drop {SUPPORTED_MEDIA_LABEL} files here, or click to browse
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Up to {UPLOAD_LIMITS.maxFileSizeMB} MB per file. Hundreds of files at a time supported.
      </p>
    </div>
  );
}

function UploadList({ queue, onUpload }: { queue: UseUploadQueueResult; onUpload: () => void | Promise<void> }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          {queue.counts.selected} file{queue.counts.selected === 1 ? '' : 's'} selected
          {queue.counts.failed > 0 ? ` · ${queue.counts.failed} failed` : ''}
        </div>
        <div className="flex gap-2">
          {queue.counts.failed > 0 && (
            <button
              type="button"
              onClick={() => void queue.retryFailed()}
              disabled={queue.isUploading}
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retry failed
            </button>
          )}
          <button
            type="button"
            onClick={queue.reset}
            disabled={queue.isUploading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => void onUpload()}
            disabled={queue.isUploading || queue.counts.ready === 0}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {queue.isUploading ? 'Uploading…' : `Upload ${queue.counts.ready}`}
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {queue.items.map((item) => (
          <UploadRow key={item.localId} item={item} onRemove={() => queue.removeItem(item.localId)} />
        ))}
      </ul>
    </div>
  );
}

function UploadRow({ item, onRemove }: { item: LocalUpload; onRemove: () => void }) {
  const showProgress = item.status === 'uploading' || item.status === 'uploaded';
  const isInflight = item.status === 'uploading' || item.status === 'requesting_url';

  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-900" title={item.file.name}>
          {item.file.name}
        </div>
        <div className="text-xs text-slate-500">
          {formatBytes(item.file.size)}
          {item.error ? ` · ${item.error}` : ''}
        </div>
        {showProgress && (
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-500 transition-[width]"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
          item.status === 'rejected' || item.status === 'failed'
            ? 'bg-rose-50 text-rose-700 ring-rose-200'
            : item.status === 'uploaded'
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            : isInflight
            ? 'bg-blue-50 text-blue-700 ring-blue-200'
            : 'bg-slate-100 text-slate-700 ring-slate-200'
        }`}
      >
        {labelFor(item.status)}
      </span>
      {!isInflight && (
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-slate-400 hover:text-slate-600"
          aria-label={`Remove ${item.file.name}`}
        >
          Remove
        </button>
      )}
    </li>
  );
}

function labelFor(s: LocalUpload['status']): string {
  switch (s) {
    case 'pending':
      return 'Ready';
    case 'requesting_url':
      return 'Preparing';
    case 'uploading':
      return 'Uploading';
    case 'uploaded':
      return 'Uploaded';
    case 'failed':
      return 'Failed';
    case 'rejected':
      return 'Rejected';
  }
}
