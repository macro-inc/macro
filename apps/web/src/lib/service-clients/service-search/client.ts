import { SERVER_HOSTS } from '@core/constant/servers';
import { getDefaultTimezone } from '@core/util/cron';
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

/** The zone ICU names when it cannot tell the host's. */
const UNKNOWN_TIME_ZONE = 'Etc/Unknown';

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
  /**
   * Dates typed into the search (`after:`, `newer_than:`) count days in the
   * person's time zone unless the request names another. A browser that
   * cannot tell its zone reports `Etc/Unknown`, which the service refuses, so
   * that search names none and reads dates in UTC.
   */
  async search(args: SearchArgs, init?: SafeFetchInit) {
    const url = `/search${buildSearchQuery(args.params)}`;
    const zone = getDefaultTimezone();
    const request = {
      ...(zone === UNKNOWN_TIME_ZONE ? {} : { time_zone: zone }),
      ...args.request,
    };
    return (
      await searchServiceFetch<UnifiedSearchResponse>(url, {
        method: 'POST',
        body: JSON.stringify(request),
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
