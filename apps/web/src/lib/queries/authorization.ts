import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CombinedError, OperationResult } from '@urql/core';
import { createSignal } from 'solid-js';

/** A cache hit cannot restore access after the server has denied this read. */
export function createQueryAuthorization(key: () => string) {
  const [denials, setDenials] = createSignal(new Map<string, CombinedError>());
  return {
    error: () => denials().get(key()),
    onResult(result: OperationResult) {
      const source = normalizedCacheResultMetadata(result)?.source;
      if (source && source !== 'live-network') return;
      if (result.error?.graphQLErrors.length) {
        setDenials((previous) => new Map(previous).set(key(), result.error!));
      } else if (!result.error && result.data && denials().has(key())) {
        setDenials((previous) => {
          const next = new Map(previous);
          next.delete(key());
          return next;
        });
      }
    },
  };
}
