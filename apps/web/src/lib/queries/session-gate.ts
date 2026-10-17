import { type SessionStatus, sessionStatus } from '@core/auth/session';
import { thrownResultErrorHasCode } from '@core/util/result';
import {
  type DefaultError,
  type DefaultedQueryObserverOptions,
  partialMatchKey,
  QueryClient,
  type QueryKey,
  type QueryObserverOptions,
} from '@tanstack/solid-query';

/**
 * Query `meta` for a query whose endpoint answers 401 without a session.
 * Such a query waits until a user is signed in instead of firing pre-login.
 */
export const requiresSession = { session: 'required' } as const;

/**
 * Query `meta` for the user-info query, which decides the session itself and
 * so must run in every state.
 */
export const establishesSession = { session: 'establishes' } as const;

function isUnauthorized(error: unknown): boolean {
  return thrownResultErrorHasCode(error, 'UNAUTHORIZED');
}

function sessionPolicy(meta: unknown): unknown {
  return meta !== null && typeof meta === 'object' && 'session' in meta
    ? meta.session
    : undefined;
}

function isBlocked(meta: unknown, status: SessionStatus): boolean {
  const policy = sessionPolicy(meta);
  if (policy === establishesSession.session) return false;
  if (policy === requiresSession.session) return status !== 'signed-in';
  return status === 'expired';
}

/**
 * Applies the session rules every query obeys:
 * - an expired session stops all queries (sign-in routing takes over), and a
 *   `requiresSession` query also waits through pending and signed-out;
 * - a 401 is never retried, whatever the query's own `retry` says;
 * - polling stops while the last fetch was a 401.
 */
export function gateQueryOnSession<
  TQueryFnData,
  TError,
  TData,
  TQueryData,
  TQueryKey extends QueryKey,
>(
  options: DefaultedQueryObserverOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  >,
  status: SessionStatus
): DefaultedQueryObserverOptions<
  TQueryFnData,
  TError,
  TData,
  TQueryData,
  TQueryKey
> {
  const { retry, refetchInterval } = options;
  return {
    ...options,
    enabled: isBlocked(options.meta, status) ? false : options.enabled,
    retry: (failureCount: number, error: TError) => {
      if (isUnauthorized(error)) return false;
      if (typeof retry === 'function') return retry(failureCount, error);
      if (typeof retry === 'number') return failureCount < retry;
      return retry !== false;
    },
    refetchInterval:
      refetchInterval === undefined || refetchInterval === false
        ? refetchInterval
        : (query) => {
            if (isUnauthorized(query.state.error)) return false;
            return typeof refetchInterval === 'function'
              ? refetchInterval(query)
              : refetchInterval;
          },
  };
}

/**
 * The app's QueryClient. Every query's options pass through
 * `defaultQueryOptions`, so the session rules apply without each query opting
 * in. solid-query reads options inside a memo, so the session signal read here
 * re-evaluates mounted queries when the session changes.
 */
export class SessionGatedQueryClient extends QueryClient {
  #sessionFamilies: QueryKey[] = [];

  /**
   * Treats every query under these key prefixes as `requiresSession`, for
   * whole families whose endpoints all answer 401 without a session. A
   * query's own `meta.session` still wins.
   */
  requireSessionFor(families: readonly QueryKey[]): void {
    this.#sessionFamilies.push(...families);
  }

  #familyMeta(queryKey: QueryKey | undefined, meta: unknown): unknown {
    if (sessionPolicy(meta) !== undefined || !queryKey) return meta;
    const inFamily = this.#sessionFamilies.some((family) =>
      partialMatchKey(queryKey, family)
    );
    if (!inFamily) return meta;
    return { ...(meta as object | undefined), ...requiresSession };
  }

  override defaultQueryOptions<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    options:
      | QueryObserverOptions<
          TQueryFnData,
          TError,
          TData,
          TQueryData,
          TQueryKey,
          TPageParam
        >
      | DefaultedQueryObserverOptions<
          TQueryFnData,
          TError,
          TData,
          TQueryData,
          TQueryKey
        >
  ): DefaultedQueryObserverOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  > {
    const defaulted = super.defaultQueryOptions(options);
    if (options._defaulted) return defaulted;
    const meta = this.#familyMeta(defaulted.queryKey, defaulted.meta);
    return gateQueryOnSession(
      meta === defaulted.meta
        ? defaulted
        : { ...defaulted, meta: meta as typeof defaulted.meta },
      sessionStatus()
    );
  }
}
