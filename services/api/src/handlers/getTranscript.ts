import { ok, conflict, wrap } from '../lib/response';
import { getJobOrFail } from '../lib/handler-utils';
import { getObjectText, presignGet } from '../lib/s3';

interface TranscriptResponse {
  jobId: string;
  fileName: string;
  text: string;
  downloadUrl: string;
  durationSeconds?: number;
  wordCount?: number;
}

export const handler = wrap(async (event) => {
  const r = await getJobOrFail(event);
  if (r.kind === 'response') return r.response;
  const job = r.job;

  if (job.status !== 'completed' || !job.transcriptTextKey) {
    return conflict(`Transcript not ready (status=${job.status}).`, event);
  }

  const [text, downloadUrl] = await Promise.all([
    getObjectText(job.transcriptTextKey),
    presignGet(job.transcriptTextKey),
  ]);

  const response: TranscriptResponse = {
    jobId: job.jobId,
    fileName: job.fileName,
    text,
    downloadUrl,
    durationSeconds: job.durationSeconds,
    wordCount: job.wordCount,
  };

  return ok(response, event);
});
