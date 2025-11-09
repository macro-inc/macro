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

export async function fetchPresigned<K extends keyof ResultMap>(
  url: string,
  responseType: K,
  init?: RequestInit
): Promise<MaybeResult<FetchError, ResultMap[K]>> {
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

    const data =
      await response[responseType as keyof Response & keyof ResultMap]();
    return ok(data);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      return err('NETWORK_ERROR', 'Network error occurred');
    } else {
      return err('UNKNOWN_ERROR', `An unknown error occurred: ${error}`);
    }
  }
}
