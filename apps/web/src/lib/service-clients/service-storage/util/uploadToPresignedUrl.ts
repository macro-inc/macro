import type { ResultError } from '@core/util/result';

import { platformFetch } from 'core/util/platformFetch';
import { err, ok, type Result } from 'neverthrow';

export async function uploadToPresignedUrl({
  presignedUrl,
  buffer,
  sha,
  type,
  signal,
}: {
  presignedUrl: string;
  buffer: BufferSource;
  sha: string;
  type: string;
  signal?: AbortSignal;
}): Promise<Result<void, ResultError<'SERVER_ERROR'>[]>> {
  const blob = new Blob([buffer], { type });

  const base64Sha = btoa(
    sha
      .match(/\w{2}/g)!
      .map((a) => String.fromCharCode(parseInt(a, 16)))
      .join('')
  );

  const response = await platformFetch(presignedUrl, {
    method: 'PUT',
    body: blob,
    headers: {
      'Content-Type': type,
      'x-amz-checksum-sha256': base64Sha,
    },
    signal,
  });

  if (!response.ok) {
    const message = await response.text();
    return err([{ code: 'SERVER_ERROR', message: message }]);
  }

  return ok(undefined);
}
