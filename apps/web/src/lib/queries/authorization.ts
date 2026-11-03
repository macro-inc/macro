import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { Client, CombinedError, OperationResult } from '@urql/core';
import { createSignal, untrack } from 'solid-js';

declare module '@urql/core' {
  interface OperationContext {
    queryAuthorization?: {
      scope: string;
      version: number;
      currentVersion: () => number;
    };
  }
}

type AuthorizationState = { version: number; error?: CombinedError };
const createAuthorizationStore = () =>
  createSignal(new Map<string, AuthorizationState>());
const CLIENT_AUTHORIZATION = new WeakMap<
  Client,
  ReturnType<typeof createAuthorizationStore>
>();
const AUTHORIZATION_CONTEXT_KEY = 'queryAuthorization';

/** A cache hit cannot restore access after the server has denied this read. */
export function createQueryAuthorization(key: () => string, client?: Client) {
  let store = client ? CLIENT_AUTHORIZATION.get(client) : undefined;
  if (!store) {
    store = createAuthorizationStore();
    if (client) CLIENT_AUTHORIZATION.set(client, store);
  }
  const [state, setState] = store;

  return {
    error: () => state().get(key())?.error,
    /** Capture each request's scope and denial version before dispatch. */
    requestContext() {
      const scope = key();
      const currentVersion = () =>
        untrack(() => state().get(scope)?.version ?? 0);
      return {
        [AUTHORIZATION_CONTEXT_KEY]: {
          scope,
          version: currentVersion(),
          currentVersion,
        },
      };
    },
    onResult(result: OperationResult) {
      const source = normalizedCacheResultMetadata(result)?.source;
      if (source && source !== 'live-network') return;
      const scope = key();
      const previous = state().get(scope);
      if (client) {
        const request = result.operation.context[AUTHORIZATION_CONTEXT_KEY];
        if (
          !request ||
          request.scope !== scope ||
          request.version !== (previous?.version ?? 0)
        )
          return;
      }
      if (result.error?.graphQLErrors.length) {
        setState((previous) =>
          new Map(previous).set(scope, {
            version: (previous.get(scope)?.version ?? 0) + 1,
            error: result.error!,
          })
        );
      } else if (!result.error && result.data && previous?.error) {
        setState((previous) =>
          new Map(previous).set(scope, {
            version: (previous.get(scope)?.version ?? 0) + 1,
          })
        );
      }
    },
  };
}
