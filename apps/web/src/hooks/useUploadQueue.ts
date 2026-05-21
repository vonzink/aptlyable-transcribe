'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_MAX_FILE_SIZE_MB,
  defaultContentTypeForFileName,
  isSupportedMediaContentType,
  isSupportedMediaFileName,
  OPENAI_MAX_AUDIO_BYTES,
} from '@aptlyable/shared';
import type { LocalUpload, TranscriptionProvider } from '@/types/jobs';
import { api } from '@/lib/api';
import { putFileToS3, runWithConcurrency } from '@/lib/uploadQueue';

const UPLOAD_CONCURRENCY = 4;
const MAX_FILE_SIZE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface UploadQueueCounts {
  selected: number;
  ready: number;
  uploading: number;
  uploaded: number;
  failed: number;
}

export interface UseUploadQueueResult {
  items: LocalUpload[];
  counts: UploadQueueCounts;
  isUploading: boolean;
  globalError: string | undefined;
  openaiOversizePending: number;
  enqueue: (files: FileList | File[]) => void;
  removeItem: (localId: string) => void;
  reset: () => void;
  upload: () => Promise<void>;
  retryFailed: () => Promise<void>;
}

/**
 * Owns the local-side upload pipeline state machine. Exposed counts
 * are derived, so any consumer (DropzoneUploader, ProgressSummary)
 * sees consistent values without re-deriving.
 */
export function useUploadQueue(provider: TranscriptionProvider): UseUploadQueueResult {
  const [items, setItems] = useState<LocalUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | undefined>(undefined);

  const updateItem = useCallback((localId: string, patch: Partial<LocalUpload>) => {
    setItems((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  }, []);

  const enqueue = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    setItems((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        const isSupportedMedia =
          isSupportedMediaFileName(file.name) &&
          (file.type === '' || isSupportedMediaContentType(file.name, file.type));
        const tooBig = file.size > MAX_FILE_SIZE_BYTES;
        const localId = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;

        if (!isSupportedMedia) {
          next.push({
            localId,
            file,
            status: 'rejected',
            progress: 0,
            error: 'Only .mp3 and .mp4 files are supported.',
          });
        } else if (tooBig) {
          next.push({
            localId,
            file,
            status: 'rejected',
            progress: 0,
            error: `File exceeds ${MAX_FILE_SIZE_MB} MB limit.`,
          });
        } else {
          next.push({ localId, file, status: 'pending', progress: 0 });
        }
      }
      return next;
    });
  }, []);

  const removeItem = useCallback((localId: string) => {
    setItems((prev) => prev.filter((p) => p.localId !== localId));
  }, []);

  const reset = useCallback(() => {
    if (isUploading) return;
    setItems([]);
    setGlobalError(undefined);
  }, [isUploading]);

  const upload = useCallback(async () => {
    setGlobalError(undefined);
    const ready = items.filter((i) => i.status === 'pending');
    if (ready.length === 0) return;
    setIsUploading(true);

    try {
      ready.forEach((it) => updateItem(it.localId, { status: 'requesting_url' }));
      // Send our local row id as `clientId` so the server can echo it
      // back. We then match upload responses to rows by that id, which
      // is unambiguous even when two files share a filename.
      const createRes = await api.createUploads(
        ready.map((it) => ({
          fileName: it.file.name,
          contentType: it.file.type || defaultContentTypeForFileName(it.file.name),
          size: it.file.size,
          clientId: it.localId,
        })),
        provider,
      );

      const localById = new Map(ready.map((it) => [it.localId, it]));

      // Server-side rejections — match by clientId (always present on
      // requests we just made; fall back to filename for safety).
      for (const rejected of createRes.rejected) {
        const local = rejected.clientId
          ? localById.get(rejected.clientId)
          : ready.find((it) => it.file.name === rejected.fileName);
        if (local) {
          updateItem(local.localId, { status: 'rejected', error: rejected.reason });
        }
      }

      // Pair API-returned uploads to local items by clientId.
      const queue: Array<{ local: LocalUpload; jobId: string; uploadUrl: string }> = [];
      for (const upload of createRes.uploads) {
        const candidate = upload.clientId ? localById.get(upload.clientId) : undefined;
        if (!candidate) continue;
        updateItem(candidate.localId, { status: 'uploading', jobId: upload.jobId });
        queue.push({ local: candidate, jobId: upload.jobId, uploadUrl: upload.uploadUrl });
      }

      // Bounded-concurrency S3 PUTs.
      const tasks = queue.map(({ local, uploadUrl }) => async () => {
        await putFileToS3({
          url: uploadUrl,
          file: local.file,
          onProgress: (loaded, total) => {
            const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
            updateItem(local.localId, { progress });
          },
        });
        updateItem(local.localId, { status: 'uploaded', progress: 100 });
      });

      const results = await runWithConcurrency(tasks, UPLOAD_CONCURRENCY);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const local = queue[i].local;
          const reason = r.reason instanceof Error ? r.reason.message : 'Upload failed.';
          updateItem(local.localId, { status: 'failed', error: reason });
        }
      });

      const completedJobIds = queue
        .filter((_, i) => results[i].status === 'fulfilled')
        .map((q) => q.jobId);

      if (completedJobIds.length > 0) {
        await api.completeUploads(completedJobIds);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      setGlobalError(message);
      setItems((prev) =>
        prev.map((p) =>
          p.status === 'requesting_url' || p.status === 'uploading'
            ? { ...p, status: 'failed', error: message }
            : p,
        ),
      );
    } finally {
      setIsUploading(false);
    }
  }, [items, provider, updateItem]);

  const retryFailed = useCallback(async () => {
    setItems((prev) =>
      prev.map((p) =>
        p.status === 'failed' ? { ...p, status: 'pending', progress: 0, error: undefined } : p,
      ),
    );
    setTimeout(() => upload(), 0);
  }, [upload]);

  const counts: UploadQueueCounts = useMemo(() => {
    let ready = 0;
    let uploading = 0;
    let uploaded = 0;
    let failed = 0;
    for (const it of items) {
      if (it.status === 'pending') ready++;
      else if (it.status === 'requesting_url' || it.status === 'uploading') uploading++;
      else if (it.status === 'uploaded') uploaded++;
      else if (it.status === 'failed' || it.status === 'rejected') failed++;
    }
    return { selected: items.length, ready, uploading, uploaded, failed };
  }, [items]);

  const openaiOversizePending = useMemo(() => {
    if (provider !== 'openai') return 0;
    return items.filter(
      (i) =>
        (i.status === 'pending' || i.status === 'failed') &&
        i.file.size > OPENAI_MAX_AUDIO_BYTES,
    ).length;
  }, [items, provider]);

  return {
    items,
    counts,
    isUploading,
    globalError,
    openaiOversizePending,
    enqueue,
    removeItem,
    reset,
    upload,
    retryFailed,
  };
}

export const UPLOAD_LIMITS = {
  maxFileSizeMB: MAX_FILE_SIZE_MB,
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  openaiMaxFileSizeBytes: OPENAI_MAX_AUDIO_BYTES,
} as const;
