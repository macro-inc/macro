import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import { err, ok, type Result } from 'neverthrow';
import type { UploadGrant } from './generated/schemas/uploadGrant';

export type SlackUploadProgress =
  | { kind: 'bytes'; loaded: number; total: number }
  | { kind: 'indeterminate'; total: number };

export type SlackUploadError =
  | {
      code:
        | 'ABORTED'
        | 'EXPIRED'
        | 'SIZE_MISMATCH'
        | 'INVALID_GRANT'
        | 'NETWORK_ERROR';
    }
  | { code: 'HTTP_ERROR'; status: number };

/** Both outcomes require uploads/complete to verify the persisted object. */
export type SlackUploadOutcome = 'uploaded' | 'already-exists';
type UploadResult = Result<SlackUploadOutcome, SlackUploadError>;

export type SlackUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: SlackUploadProgress) => void;
};

function uploadStatus(status: number): UploadResult {
  if (status === 412) return ok('already-exists');
  if (status >= 200 && status < 300) return ok('uploaded');
  if (status === 0) return err({ code: 'NETWORK_ERROR' });
  return err({ code: 'HTTP_ERROR', status });
}

/**
 * PUT exact bytes once, without app credentials or automatic retries. A 412 is
 * never retried as an overwrite. The query layer owns completion verification
 * and renewal of expired grants using the identical registered descriptor.
 */
export async function uploadSlackImport(
  grant: UploadGrant,
  blob: Blob,
  options: SlackUploadOptions = {}
): Promise<UploadResult> {
  if (options.signal?.aborted) return err({ code: 'ABORTED' });
  if (
    !Number.isSafeInteger(grant.descriptor.byteLength) ||
    blob.size !== grant.descriptor.byteLength
  ) {
    return err({ code: 'SIZE_MISMATCH' });
  }
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt)) return err({ code: 'INVALID_GRANT' });
  if (expiresAt <= Date.now()) return err({ code: 'EXPIRED' });

  // Only S3 upload headers are accepted. In particular, Content-Length and
  // Host must be derived by the transport, never set as browser headers.
  const headers = Object.entries(grant.requiredHeaders);
  if (
    headers.some(
      ([name]) => !/^(content-type|if-none-match|x-amz-[a-z0-9-]+)$/i.test(name)
    )
  ) {
    return err({ code: 'INVALID_GRANT' });
  }
  try {
    const normalized = new Headers(grant.requiredHeaders);
    if (
      normalized.get('if-none-match') !== '*' ||
      !normalized.get('content-type') ||
      !normalized.get('x-amz-checksum-sha256')
    ) {
      return err({ code: 'INVALID_GRANT' });
    }
  } catch {
    return err({ code: 'INVALID_GRANT' });
  }

  if (isTauri()) return uploadWithNativeFetch(grant, blob, options);
  return uploadWithXhr(grant, blob, options);
}

async function uploadWithNativeFetch(
  grant: UploadGrant,
  blob: Blob,
  options: SlackUploadOptions
): Promise<UploadResult> {
  // The native HTTP plugin does not expose upload byte progress.
  options.onProgress?.({ kind: 'indeterminate', total: blob.size });
  try {
    const response = await platformFetch(grant.url, {
      method: 'PUT',
      body: blob,
      headers: grant.requiredHeaders,
      signal: options.signal,
      credentials: 'omit',
      redirect: 'error',
    });
    // Release the native response resource; neither ETag nor the response body
    // substitutes for the server's checksum/length completion verification.
    await response.body?.cancel();
    if (options.signal?.aborted) return err({ code: 'ABORTED' });
    return uploadStatus(response.status);
  } catch {
    return err({ code: options.signal?.aborted ? 'ABORTED' : 'NETWORK_ERROR' });
  }
}

function uploadWithXhr(
  grant: UploadGrant,
  blob: Blob,
  { signal, onProgress }: SlackUploadOptions
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    function finish(result: UploadResult): void {
      signal?.removeEventListener('abort', abort);
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      resolve(result);
    }
    function abort(): void {
      xhr.abort();
      finish(err({ code: 'ABORTED' }));
    }
    xhr.onload = () => finish(uploadStatus(xhr.status));
    xhr.onerror = () => finish(err({ code: 'NETWORK_ERROR' }));
    xhr.ontimeout = () => finish(err({ code: 'NETWORK_ERROR' }));
    xhr.onabort = () => finish(err({ code: 'ABORTED' }));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ kind: 'bytes', loaded: event.loaded, total: blob.size });
      } else {
        onProgress?.({ kind: 'indeterminate', total: blob.size });
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      xhr.open('PUT', grant.url);
      xhr.withCredentials = false;
      for (const [name, value] of Object.entries(grant.requiredHeaders)) {
        xhr.setRequestHeader(name, value);
      }
      xhr.send(blob);
    } catch {
      finish(err({ code: 'NETWORK_ERROR' }));
    }
  });
}
