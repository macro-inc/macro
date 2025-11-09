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

const searchServiceHost = `${SERVER_HOSTS['search-service']}`;

import type { ChatSearchRequest } from './generated/models/chatSearchRequest';
import type { ChatSearchResponse } from './generated/models/chatSearchResponse';
import type { DocumentSearchRequest } from './generated/models/documentSearchRequest';
import type { DocumentSearchResponse } from './generated/models/documentSearchResponse';
import type { EmailSearchParams } from './generated/models/emailSearchParams';
import type { EmailSearchRequest } from './generated/models/emailSearchRequest';
import type { EmailSearchResponse } from './generated/models/emailSearchResponse';
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

type WithPagination = {
  page: number;
  page_size: number;
};

export type PaginatedSearchArgs = {
  params: WithPagination;
  request: UnifiedSearchRequest;
};

export const searchClient = {
  async searchDocuments(args: DocumentSearchRequest) {
    return mapOk(
      await searchServiceFetch<DocumentSearchResponse>(`/search/document`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async searchEmails(args: {
    request: EmailSearchRequest;
    params: EmailSearchParams;
  }) {
    return mapOk(
      await searchServiceFetch<EmailSearchResponse>(
        `/search/email?page=${args.params.page ?? 0}&page_size=${args.params.page_size ?? 10}`,
        {
          method: 'POST',
          body: JSON.stringify(args.request),
        }
      ),
      (result) => result
    );
  },
  async searchChats(args: ChatSearchRequest) {
    return mapOk(
      await searchServiceFetch<ChatSearchResponse>(`/search/chat`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async search(args: PaginatedSearchArgs) {
    return mapOk(
      await searchServiceFetch<UnifiedSearchResponse>(
        `/search?page=${args.params.page}&page_size=${args.params.page_size}`,
        {
          method: 'POST',
          body: JSON.stringify(args.request),
        }
      ),
      (result) => result
    );
  },
};
