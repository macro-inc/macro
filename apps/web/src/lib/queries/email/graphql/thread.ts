import {
  createUrqlInfiniteQuery,
  type UrqlInfiniteQueryResult,
} from '@app/lib/urql-solid';
import { useFlowTrace } from '@app/observability/flow';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import { Telemetry } from '@macro-inc/observability';
import type { ApiThread } from '@service-email/generated/schemas';
import {
  EmailThreadIdentityFieldsFragmentDoc,
  EmailThreadPageDocument,
  type EmailThreadPageQuery,
  type EmailThreadPageQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { registerActiveGraphqlSoupQuery } from '../../soup/graphql/active-queries';
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

type ThreadIdentity = {
  requested: string;
  canonical: string;
  /** A failed or unanswered lookup is not proof of a local draft. Only `local`
   * forbids network reads; an `unknown` thread is read from the server without
   * storing the answer, until the cache answers. */
  kind: 'remote' | 'local' | 'unknown';
};

/**
 * How long an open thread waits for the cache to tell a local draft from a
 * server thread before reading it from the server. The lookup normally answers
 * well within this; a cache that stops answering must not hold the thread.
 */
const IDENTITY_WAIT_MS = 1_000;

function unresolvedInCache(kind: ThreadIdentity['kind'] | undefined) {
  return kind === 'unknown' && graphqlCacheEnabled();
}

function threadRequestPolicy(kind: ThreadIdentity['kind'] | undefined) {
  if (kind === 'local') return 'cache-only';
  if (unresolvedInCache(kind)) return 'network-only';
  return 'cache-and-network';
}

/** Resolve a durable local route before contacting the server with its ID. */
async function cachedThreadIdentity(
  threadId: string,
  previous?: ThreadIdentity
): Promise<ThreadIdentity> {
  const cacheRequired = graphqlCacheEnabled();
  const host = cacheRequired ? getGraphqlCacheHost() : undefined;
  if (cacheRequired && !host) {
    throw new Error('Email cache is unavailable; thread identity is unknown');
  }
  const result = host
    ? await readRecordsByKeys(
        host,
        selectRecords(EmailThreadIdentityFieldsFragmentDoc),
        [`GraphqlSoupEmailThread:${threadId}`]
      ).catch((error) => {
        // Initialization may retire the host while this first read is pending.
        // Only session-wide fallback makes an unresolved route safe to fetch.
        if (graphqlCacheEnabled()) throw error;
        return undefined;
      })
    : undefined;
  // Cache fallback must not discard positive knowledge of an unsynced draft
  // or an already-resolved server alias, even if the latest lookup failed.
  if (
    !result &&
    !graphqlCacheEnabled() &&
    previous?.requested === threadId &&
    previous.kind !== 'unknown'
  ) {
    return previous;
  }
  const selected = result?.records[0];
  return {
    requested: threadId,
    canonical: selected?.record.id ?? threadId,
    // Pending edits do not make an existing server identity local again.
    // Every authoritative Mail thread carries a projection capsule; only a
    // newly created optimistic thread has no server capsule yet.
    kind:
      selected?.identity?.pending === true &&
      selected.record.id === threadId &&
      selected.record.cacheProjection === null
        ? 'local'
        : 'remote',
  };
}

/**
 * Fetches the first page of an email thread through the persistent GraphQL
 * cache. A normal read still waits for the network, but while the persistent
 * cache is active a transport failure falls back to the previously persisted
 * operation so a visited thread can be opened offline. Every failure is
 * thrown as a ThrownResultError with typed result codes.
 */
export async function fetchGraphqlEmailThread(
  threadId: string,
  offset = 0
): Promise<ApiThread> {
  getGraphqlSoupClient();
  const identity = await cachedThreadIdentity(threadId);
  // An asynchronous cache initialization failure can replace the client while
  // resolving identity. Use the session's current transport after that read.
  const client = getGraphqlSoupClient();
  if (identity.kind === 'local' && !graphqlCacheEnabled()) {
    throw new ThrownResultError([
      {
        code: 'UNKNOWN',
        message: 'Email cache is unavailable for this local draft',
      },
    ]);
  }
  const variables: EmailThreadPageQueryVariables = {
    threadId: identity.canonical,
    offset,
    limit: DEFAULT_THREAD_MESSAGES_LIMIT,
  };
  const result = await client
    .query<EmailThreadPageQuery, EmailThreadPageQueryVariables>(
      EmailThreadPageDocument,
      variables,
      {
        requestPolicy:
          identity.kind === 'local' ? 'cache-only' : 'cache-and-network',
      }
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
): {
  query: GraphqlEmailThreadQuery<TData>;
  resolvedThreadId: Accessor<string>;
  identityPending: Accessor<boolean>;
} {
  // Client construction installs the host. Subscribe before the first read so
  // settlement cannot leave a reopened local thread stuck on cache-only.
  getGraphqlSoupClient();
  const host = getGraphqlCacheHost();
  const [identity, setIdentity] = createSignal<ThreadIdentity>();
  const [returnedIdentity, setReturnedIdentity] = createSignal<{
    requested: string;
    queried: string;
    canonical: string;
  }>();
  let request = 0;
  let lookingUp: string | undefined;
  let lookUpAgain = false;
  let disposed = false;
  // A fallback recorded while the opening view loads joins its trace.
  const flowTrace = useFlowTrace();
  const isCurrent = (id: string, generation: number) =>
    !disposed && generation === request && id === threadId();

  // While the cache cannot say whether the route is a local draft, read the
  // thread from the server.
  const fallBackToServer = (
    id: string,
    reason: 'timeout' | 'error',
    startedAt: number
  ) => {
    if (untrack(identity)?.requested === id) return;
    const recordFallback = () => {
      const span = Telemetry.span('email.thread.identity_fallback');
      span.setAttr('email.thread_id', id);
      span.setAttr('email.thread.identity_fallback_reason', reason);
      span.setAttr(
        'email.thread.identity_wait_ms',
        Math.round(performance.now() - startedAt)
      );
      span.end();
    };
    if (flowTrace) flowTrace.run(recordFallback);
    else recordFallback();
    setIdentity({ requested: id, canonical: id, kind: 'unknown' });
  };

  // One lookup at a time per thread. A cache change during a lookup asks for
  // one more after it instead of discarding its answer: a busy cache reports
  // changes faster than it answers reads, so no answer would ever land.
  const refreshIdentity = async () => {
    const id = threadId();
    if (lookingUp === id) {
      lookUpAgain = true;
      return;
    }
    const generation = ++request;
    lookingUp = id;
    const startedAt = performance.now();
    const deadline = setTimeout(() => {
      if (isCurrent(id, generation)) fallBackToServer(id, 'timeout', startedAt);
    }, IDENTITY_WAIT_MS);
    try {
      do {
        lookUpAgain = false;
        try {
          const result = await cachedThreadIdentity(id, untrack(identity));
          if (!isCurrent(id, generation)) return;
          setIdentity((previous) =>
            previous?.requested === result.requested &&
            previous.canonical === result.canonical &&
            previous.kind === result.kind
              ? previous
              : result
          );
        } catch {
          // An initially unreadable identity may still be a local draft.
          // Preserve any known identity and policy; otherwise read from the
          // server until the cache answers.
          if (isCurrent(id, generation))
            fallBackToServer(id, 'error', startedAt);
        }
      } while (lookUpAgain && isCurrent(id, generation));
    } finally {
      clearTimeout(deadline);
      if (generation === request) lookingUp = undefined;
    }
  };
  // The memo re-reads identity only when the id value changes, not whenever
  // the accessor's underlying route or props signal does.
  createEffect(
    on(createMemo(threadId), () => {
      fireAndForget(refreshIdentity(), 'email-thread');
    })
  );
  const unsubscribe = host?.onCacheChanged(() => {
    fireAndForget(refreshIdentity(), 'email-thread');
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe?.();
  });
  const queryThreadId = () =>
    identity()?.requested === threadId() ? identity()!.canonical : threadId();
  const resolvedThreadId = () => {
    const returned = returnedIdentity();
    return returned?.requested === threadId() &&
      returned.queried === queryThreadId()
      ? returned.canonical
      : queryThreadId();
  };
  const query = createUrqlInfiniteQuery<
    EmailThreadPageQuery,
    EmailThreadPageQueryVariables,
    number,
    TData
  >(() => ({
    query: EmailThreadPageDocument,
    client: getGraphqlSoupClient(),
    initialPageParam: 0,
    variables: (offset) => ({
      threadId: queryThreadId(),
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
    enabled:
      options().enabled &&
      (graphqlCacheEnabled()
        ? !!getGraphqlCacheHost()
        : identity()?.kind !== 'local') &&
      threadId().length > 0 &&
      identity()?.requested === threadId(),
    requestPolicy: threadRequestPolicy(identity()?.kind),
    // A server "not found" for an unresolved local draft must not be stored
    // over the draft's cached thread.
    context: unresolvedInCache(identity()?.kind)
      ? { persistResult: false }
      : undefined,
    keepPreviousData: false,
    onResult: (result, { pageIndex }) => {
      const canonical = result.data?.user.emailThread?.id;
      const queried = result.operation.variables.threadId;
      if (
        pageIndex !== 0 ||
        result.error ||
        !canonical ||
        queried !== untrack(queryThreadId)
      )
        return;
      setReturnedIdentity({ requested: untrack(threadId), queried, canonical });
    },
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
  // Cached threads observe the shared email record. Fetch-only readers instead
  // opt into their own archive/unarchive completion, never generic Soup or
  // read/unread refreshes (which can disrupt a successfully opened thread).
  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: () =>
        query.isEnabled &&
        !graphqlCacheEnabled() &&
        identity()?.kind !== 'local',
      target: () => ({ kind: 'email-archive', threadId: resolvedThreadId() }),
      refresh: async () => {
        await query.refetch({
          requestPolicy: 'network-only',
          throwOnError: true,
        });
      },
    })
  );
  return {
    query,
    resolvedThreadId,
    identityPending: () => identity()?.requested !== threadId(),
  };
}
