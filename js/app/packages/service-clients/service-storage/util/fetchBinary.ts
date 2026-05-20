import type { ResultError } from '@core/util/result';

import { platformFetch } from 'core/util/platformFetch';
import { err, ok, type Result } from 'neverthrow';
import type { StorageError } from './storageError';

export async function fetchBinary(
  url: string,
  responseType: 'arraybuffer',
  init?: RequestInit
): Promise<Result<ArrayBuffer, ResultError<StorageError>[]>>;
export async function fetchBinary(
  url: string,
  responseType: 'blob',
  init?: RequestInit
): Promise<Result<Blob, ResultError<StorageError>[]>>;
export async function fetchBinary<T extends ArrayBuffer | Blob>(
  url: string,
  responseType: 'arraybuffer' | 'blob',
  init?: RequestInit
): Promise<Result<T, ResultError<StorageError>[]>> {
  try {
    const response = await platformFetch(url, init);

    if (!response.ok) {
      switch (response.status) {
        case 404:
          return err([{ code: 'NOT_FOUND', message: 'Resource not found' }]);
        case 401:
          return err([
            { code: 'UNAUTHORIZED', message: 'Unauthorized access' },
          ]);
        case 500:
          return err([
            { code: 'SERVER_ERROR', message: 'Internal server error' },
          ]);
        default:
          return err([
            {
              code: 'HTTP_ERROR',
              message: `HTTP error! status: ${response.status}`,
            },
          ]);
      }
    }

    const data = await (responseType === 'arraybuffer'
      ? response.arrayBuffer()
      : response.blob());
    return ok(data as T);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return err([
        { code: 'NETWORK_ERROR', message: 'Network error occurred' },
      ]);
    } else {
      return err([
        {
          code: 'UNKNOWN_ERROR',
          message: `An unknown error occurred: ${error}`,
        },
      ]);
    }
  }
}
