import type {
  CreateUploadsResponse,
  CompleteUploadsResponse,
  ListJobsResponse,
  Job,
  TranscriptResponse,
  TranscriptionProvider,
} from '@/types/jobs';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? '';

if (!BASE && typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.warn(
    'NEXT_PUBLIC_API_BASE_URL is not set. The frontend cannot call the API.',
  );
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => undefined);
    }
    const err = new Error(`API ${res.status}: ${res.statusText}`);
    (err as Error & { detail?: unknown }).detail = detail;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  createUploads: (
    files: Array<{
      fileName: string;
      contentType: string;
      size: number;
      clientId?: string;
    }>,
    provider?: TranscriptionProvider,
  ) =>
    http<CreateUploadsResponse>('/api/uploads/create', {
      method: 'POST',
      body: JSON.stringify({ files, provider }),
    }),

  completeUploads: (jobIds: string[]) =>
    http<CompleteUploadsResponse>('/api/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ jobIds }),
    }),

  listJobs: (params?: { status?: string; limit?: number; cursor?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const q = query.toString();
    return http<ListJobsResponse>(`/api/jobs${q ? `?${q}` : ''}`);
  },

  getJob: (jobId: string) => http<Job>(`/api/jobs/${jobId}`),

  getTranscript: (jobId: string) =>
    http<TranscriptResponse>(`/api/jobs/${jobId}/transcript`),

  getRawJson: (jobId: string) =>
    http<{ jobId: string; downloadUrl: string }>(`/api/jobs/${jobId}/raw`),

  retryJob: (jobId: string) =>
    http<{ jobId: string; status: 'queued' }>(`/api/jobs/${jobId}/retry`, {
      method: 'POST',
    }),
};
