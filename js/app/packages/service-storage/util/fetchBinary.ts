import { err, type MaybeResult, ok } from '@core/util/maybeResult';
import { platformFetch } from 'core/util/platformFetch';
import type { DocumentMetadata } from '../generated/schemas/documentMetadata';
import type { StorageError } from './storageError';

export async function fetchBinary(
  url: string,
  responseType: 'arraybuffer',
  init?: RequestInit
): Promise<MaybeResult<StorageError, ArrayBuffer>>;
export async function fetchBinary(
  url: string,
  responseType: 'blob',
  init?: RequestInit
): Promise<MaybeResult<StorageError, Blob>>;
export async function fetchBinary<T extends ArrayBuffer | Blob>(
  url: string,
  responseType: 'arraybuffer' | 'blob',
  init?: RequestInit
): Promise<MaybeResult<StorageError, T>> {
  try {
    const response = await platformFetch(url, init);

    if (!response.ok) {
      switch (response.status) {
        case 404:
          return err('NOT_FOUND', 'Resource not found');
        case 401:
          return err('UNAUTHORIZED', 'Unauthorized access');
        case 500:
          return err('SERVER_ERROR', 'Internal server error');
        default:
          return err('HTTP_ERROR', `HTTP error! status: ${response.status}`);
      }
    }

    const data = await (responseType === 'arraybuffer'
      ? response.arrayBuffer()
      : response.blob());
    return ok(data as T);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return err('NETWORK_ERROR', 'Network error occurred');
    } else {
      return err('UNKNOWN_ERROR', `An unknown error occurred: ${error}`);
    }
  }
}

export type BinaryFile = {
  blob: Blob;
  metadata: DocumentMetadata;
};
