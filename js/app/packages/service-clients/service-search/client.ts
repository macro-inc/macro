import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';

const searchServiceHost = `${SERVER_HOSTS['document-storage-service']}`;

import type { ChannelSearchRequest } from './generated/models/channelSearchRequest';
import type { ChannelSearchResponse } from './generated/models/channelSearchResponse';
import type { UnifiedSearchRequest } from './generated/models/unifiedSearchRequest';
import type { UnifiedSearchResponse } from './generated/models/unifiedSearchResponse';

export type { ChannelSearchRequest };

function searchServiceFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function searchServiceFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function searchServiceFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
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

type ChannelSearchArgs = {
  params: SearchParams;
  request: ChannelSearchRequest;
};

const buildSearchQuery = (params: SearchParams) => {
  const qp = new URLSearchParams();
  if (params.page_size !== undefined) {
    qp.append('page_size', params.page_size.toString());
  }
  if (params.cursor) {
    qp.append('cursor', params.cursor);
  }
  const qs = qp.toString();
  return qs ? `?${qs}` : '';
};

export const searchClient = {
  async search(args: SearchArgs, init?: SafeFetchInit) {
    const url = `/search${buildSearchQuery(args.params)}`;
    return (
      await searchServiceFetch<UnifiedSearchResponse>(url, {
        method: 'POST',
        body: JSON.stringify(args.request),
        ...init,
      })
    ).map((result) => result);
  },

  async searchChannel(args: ChannelSearchArgs, init?: SafeFetchInit) {
    const url = `/search/channel${buildSearchQuery(args.params)}`;
    return (
      await searchServiceFetch<ChannelSearchResponse>(url, {
        method: 'POST',
        body: JSON.stringify(args.request),
        ...init,
      })
    ).map((result) => result);
  },
};
