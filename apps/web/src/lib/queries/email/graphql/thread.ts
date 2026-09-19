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
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
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

/**
 * Maps a GraphQL transport error onto the typed result codes the email query
 * facade exposes.
 */
export function mapGraphqlThreadError(error: CombinedError): ThrownResultError {
  // Selector failures are normalized into CombinedError.networkError; a
  // ThrownResultError thrown there (e.g. NOT_FOUND from threadFromPage)
  // carries typed codes — surface it rather than flattening to UNKNOWN.
  if (error.networkError instanceof ThrownResultError) {
    return error.networkError;
  }

  const resultErrors = error.graphQLErrors.map((graphqlError) => ({
    ...graphqlError.extensions,
    code:
      typeof graphqlError.extensions?.code === 'string'
        ? graphqlError.extensions.code
        : 'UNKNOWN',
    message: graphqlError.message,
  }));
  return new ThrownResultError(
    resultErrors.length > 0
      ? resultErrors
      : [
          {
            code: 'UNKNOWN',
            message: error.networkError?.message ?? error.message,
          },
        ]
  );
}

/**
 * Fetches the first page of an email thread through the persistent GraphQL
 * cache. A normal read still waits for the network, but while the persistent
 * cache is active a transport failure falls back to the previously persisted
 * operation so a visited thread can be opened offline. Every failure is
 * thrown as a ThrownResultError with typed result codes.
 */
export async function fetchGraphqlEmailThread(
  threadId: string
): Promise<ApiThread> {
  const client = getGraphqlSoupClient();
  const variables: EmailThreadPageQueryVariables = {
    threadId,
    offset: 0,
    limit: DEFAULT_THREAD_MESSAGES_LIMIT,
  };
  const result = await client
    .query<EmailThreadPageQuery, EmailThreadPageQueryVariables>(
      EmailThreadPageDocument,
      variables,
      { requestPolicy: 'cache-and-network' }
    )
    .toPromise();

  if (result.error) {
    // Without an active cache exchange a `cache-only` request is never
    // answered, so only fall back when the persistent cache is live.
    if (result.error.networkError && graphqlCacheEnabled()) {
      const cached = await client
        .query<EmailThreadPageQuery, EmailThreadPageQueryVariables>(
          EmailThreadPageDocument,
          variables,
          { requestPolicy: 'cache-only' }
        )
        .toPromise();
      if (cached.data) {
        return mapGraphqlEmailThreadPage(threadFromPage(cached.data));
      }
    }
    throw mapGraphqlThreadError(result.error);
  }

  if (!result.data) {
    throw new ThrownResultError([
      {
        code: 'UNKNOWN',
        message: 'GraphQL email thread query returned no data',
      },
    ]);
  }

  return mapGraphqlEmailThreadPage(threadFromPage(result.data));
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
