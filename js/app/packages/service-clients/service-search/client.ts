import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';

import type { SafeFetchInit } from '@core/util/safeFetch';

const searchServiceHost = `${SERVER_HOSTS['document-storage-service']}`;

import type { UnifiedSearchRequest } from './generated/models/unifiedSearchRequest';
import type { UnifiedSearchResponse } from './generated/models/unifiedSearchResponse';

export function searchServiceFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function searchServiceFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function searchServiceFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${searchServiceHost}${url}`, init);
}

export type SearchParams = {
  cursor?: string | null;
  page_size?: number;
};

export type SearchArgs = {
  params: SearchParams;
  request: UnifiedSearchRequest;
};

export const searchClient = {
  async search(args: SearchArgs, init?: SafeFetchInit) {
    const params = new URLSearchParams();

    if (args.params.page_size !== undefined) {
      params.append('page_size', args.params.page_size.toString());
    }
    if (args.params.cursor) {
      params.append('cursor', args.params.cursor);
    }

    const queryString = params.toString();
    const url = queryString ? `/search?${queryString}` : '/search';

    return mapOk(
      await searchServiceFetch<UnifiedSearchResponse>(url, {
        method: 'POST',
        body: JSON.stringify(args.request),
        ...init,
      }),
      (result) => result
    );
  },
};
