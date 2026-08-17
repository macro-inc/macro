import {
  createUrqlInfiniteQuery,
  type UrqlInfiniteQueryResult,
} from '@app/lib/urql-solid';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { ThrownResultError } from '@core/util/result';
import type { ApiThread } from '@service-email/generated/schemas';
import {
  EmailThreadPageDocument,
  type EmailThreadPageQuery,
  type EmailThreadPageQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';
import { mapGraphqlEmailThreadPage } from './mapper';

/** REST-compatible pages exposed to the email query facade. */
export type GraphqlEmailThreadPages = {
  pages: ApiThread[];
  pageParams: number[];
};

/** Reactive controls accepted by the GraphQL thread query. */
export type GraphqlEmailThreadQueryOptions<TData> = {
  enabled: boolean;
  select?: (data: GraphqlEmailThreadPages) => TData;
};

/** Live paginated GraphQL thread query. */
export type GraphqlEmailThreadQuery<TData = GraphqlEmailThreadPages> =
  UrqlInfiniteQueryResult<
    EmailThreadPageQuery,
    EmailThreadPageQueryVariables,
    number,
    TData
  >;

function threadFromPage(page: EmailThreadPageQuery) {
  const thread = page.user.emailThread;
  if (thread) return thread;

  // Direct lookup currently returns null for both missing and inaccessible
  // threads. Restore distinct states when the API exposes a typed result.
  throw new ThrownResultError([
    { code: 'NOT_FOUND', message: 'Email thread not found' },
  ]);
}

/** Creates the native urql-solid query for one thread's message pages. */
export function createGraphqlEmailThreadQuery<TData = GraphqlEmailThreadPages>(
  threadId: Accessor<string>,
  options: Accessor<GraphqlEmailThreadQueryOptions<TData>>
): GraphqlEmailThreadQuery<TData> {
  return createUrqlInfiniteQuery<
    EmailThreadPageQuery,
    EmailThreadPageQueryVariables,
    number,
    TData
  >(() => ({
    query: EmailThreadPageDocument,
    client: getGraphqlSoupClient(),
    initialPageParam: 0,
    variables: (offset) => ({
      threadId: threadId(),
      offset,
      limit: DEFAULT_THREAD_MESSAGES_LIMIT,
    }),
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const thread = lastPage.user.emailThread;
      if (!thread || thread.messages.length < DEFAULT_THREAD_MESSAGES_LIMIT) {
        return undefined;
      }
      return lastPageParam + thread.messages.length;
    },
    enabled: options().enabled && threadId().length > 0,
    requestPolicy: 'cache-and-network',
    keepPreviousData: false,
    select: ({ pages, pageParams }) => {
      const mapped = {
        pages: pages.map((page) =>
          mapGraphqlEmailThreadPage(threadFromPage(page))
        ),
        pageParams: [...pageParams],
      };
      return options().select?.(mapped) ?? (mapped as TData);
    },
  }));
}
