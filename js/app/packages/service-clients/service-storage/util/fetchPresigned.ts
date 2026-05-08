import type { FetchError } from '@core/service';
import {
  err,
  type MaybeResult,
  type ObjectLike,
  ok,
} from '@core/util/maybeResult';
import { platformFetch } from 'core/util/platformFetch';

type ResultMap = {
  arraybuffer: ArrayBuffer;
  blob: Blob;
  text: string & {};
  json: ObjectLike;
};

function httpStatusToError(status: number) {
  switch (status) {
    case 404:
      return err('NOT_FOUND', 'Resource not found');
    case 401:
      return err('UNAUTHORIZED', 'Unauthorized access');
    case 500:
      return err('SERVER_ERROR', 'Internal server error');
    default:
      return err('HTTP_ERROR', `HTTP error! status: ${status}`);
  }
}

function fetchExceptionToError(error: unknown) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return err('NETWORK_ERROR', 'Network error occurred');
  }
  return err('UNKNOWN_ERROR', `An unknown error occurred: ${error}`);
}

export async function fetchPresigned<K extends keyof ResultMap>(
  url: string,
  responseType: K,
  init?: RequestInit
): Promise<MaybeResult<FetchError, ResultMap[K]>> {
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
): Promise<MaybeResult<FetchError, Blob>> {
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
