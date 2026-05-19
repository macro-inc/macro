import type { FetchError } from '@core/service';
import type { ObjectLike, ResultError } from '@core/util/result';
import { platformFetch } from 'core/util/platformFetch';
import { err, ok, type Result } from 'neverthrow';

type ResultMap = {
  arraybuffer: ArrayBuffer;
  blob: Blob;
  text: string & {};
  json: ObjectLike;
};

function httpStatusToError(
  status: number
): Result<never, ResultError<FetchError>[]> {
  switch (status) {
    case 404:
      return err<never, ResultError<FetchError>[]>([
        { code: 'NOT_FOUND', message: 'Resource not found' },
      ]);
    case 401:
      return err<never, ResultError<FetchError>[]>([
        { code: 'UNAUTHORIZED', message: 'Unauthorized access' },
      ]);
    case 500:
      return err<never, ResultError<FetchError>[]>([
        { code: 'SERVER_ERROR', message: 'Internal server error' },
      ]);
    default:
      return err<never, ResultError<FetchError>[]>([
        { code: 'HTTP_ERROR', message: `HTTP error! status: ${status}` },
      ]);
  }
}

function fetchExceptionToError(
  error: unknown
): Result<never, ResultError<FetchError>[]> {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return err<never, ResultError<FetchError>[]>([
      { code: 'NETWORK_ERROR', message: 'Network error occurred' },
    ]);
  }
  return err<never, ResultError<FetchError>[]>([
    { code: 'UNKNOWN_ERROR', message: `An unknown error occurred: ${error}` },
  ]);
}

export async function fetchPresigned<K extends keyof ResultMap>(
  url: string,
  responseType: K,
  init?: RequestInit
): Promise<Result<ResultMap[K], ResultError<FetchError>[]>> {
  try {
    const response = await platformFetch(url, init);

    if (!response.ok) {
      return httpStatusToError(response.status);
    }

    const data =
      await response[responseType as keyof Response & keyof ResultMap]();
    return ok(data);
  } catch (error) {
    return fetchExceptionToError(error);
  }
}

export type FetchProgress = {
  loaded: number;
  /** 0 when Content-Length is missing. */
  total: number;
};

export async function fetchPresignedBlobWithProgress(
  url: string,
  onProgress: (progress: FetchProgress) => void,
  init?: RequestInit
): Promise<Result<Blob, ResultError<FetchError>[]>> {
  try {
    const response = await platformFetch(url, init);

    if (!response.ok) {
      return httpStatusToError(response.status);
    }

    const totalHeader = response.headers.get('Content-Length');
    const total = totalHeader ? Number.parseInt(totalHeader, 10) : 0;
    const contentType = response.headers.get('Content-Type') ?? undefined;

    onProgress({ loaded: 0, total });

    if (!response.body) {
      const blob = await response.blob();
      onProgress({ loaded: blob.size, total: blob.size });
      return ok(blob);
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(
        value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength
        ) as ArrayBuffer
      );
      loaded += value.byteLength;
      onProgress({ loaded, total });
    }

    return ok(new Blob(chunks, contentType ? { type: contentType } : {}));
  } catch (error) {
    return fetchExceptionToError(error);
  }
}
