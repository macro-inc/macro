import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import type { ResultError } from '@core/util/result';
import { err, ok, type Result } from 'neverthrow';

type UploadResult = Result<void, ResultError<'SERVER_ERROR'>[]>;

export async function uploadToPresignedUrl({
  presignedUrl,
  buffer,
  sha,
  type,
  signal,
  onProgress,
}: {
  presignedUrl: string;
  buffer: BufferSource;
  sha: string;
  type: string;
  signal?: AbortSignal;
  /**
   * Bytes sent so far. Browsers report it as the body uploads; the Tauri HTTP
   * plugin can't, so there it is only reported as null before the request.
   */
  onProgress?: (sent: number | null) => void;
}): Promise<UploadResult> {
  const blob = new Blob([buffer], { type });

  const base64Sha = btoa(
    sha
      .match(/\w{2}/g)!
      .map((a) => String.fromCharCode(parseInt(a, 16)))
      .join('')
  );
  const headers = {
    'Content-Type': type,
    'x-amz-checksum-sha256': base64Sha,
  };

  if (onProgress && !isTauri()) {
    return uploadWithXhr({ presignedUrl, blob, headers, signal, onProgress });
  }

  onProgress?.(null);
  const response = await platformFetch(presignedUrl, {
    method: 'PUT',
    body: blob,
    headers,
    signal,
  });

  if (!response.ok) {
    const message = await response.text();
    return err([{ code: 'SERVER_ERROR', message: message }]);
  }

  return ok(undefined);
}

/** `fetch` can't report upload progress, so the browser path uses XHR. */
function uploadWithXhr({
  presignedUrl,
  blob,
  headers,
  signal,
  onProgress,
}: {
  presignedUrl: string;
  blob: Blob;
  headers: Record<string, string>;
  signal?: AbortSignal;
  onProgress: (sent: number) => void;
}): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = () => signal?.removeEventListener('abort', abort);

    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size);
        resolve(ok(undefined));
      } else {
        resolve(err([{ code: 'SERVER_ERROR', message: xhr.responseText }]));
      }
    };
    // Mirror fetch, which rejects on network failure and abort.
    xhr.onerror = () => {
      settle();
      reject(new TypeError('Failed to upload file'));
    };
    xhr.onabort = () => {
      settle();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    xhr.open('PUT', presignedUrl);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    onProgress(0);
    xhr.send(blob);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
