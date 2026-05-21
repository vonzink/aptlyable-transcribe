import { defaultContentTypeForFileName } from '@aptlyable/shared';

/**
 * Upload one File to a presigned S3 URL via XHR (so we can report progress).
 * Resolves when the PUT returns 2xx; rejects otherwise.
 */
export function putFileToS3(params: {
  url: string;
  file: File;
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { url, file, onProgress, signal } = params;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || defaultContentTypeForFileName(file.name));

    if (onProgress) {
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 PUT failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during S3 upload.'));
    xhr.onabort = () => reject(new Error('Upload aborted.'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

/**
 * Run an array of async tasks with a fixed concurrency limit. Each task
 * is a function returning a promise. Errors don't stop the queue — they
 * surface in the returned settled results.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { status: 'fulfilled', value };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  }

  const slots = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: slots }, () => worker()));
  return results;
}
