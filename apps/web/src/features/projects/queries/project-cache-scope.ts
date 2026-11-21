import { UNKNOWN_CACHE_GENERATION } from '@graphql-cache/generation-mirror';
import type { CacheHost } from '@graphql-cache/host/types';
import { type Accessor, createSignal } from 'solid-js';

/** Async project creation must not publish into a replacement viewer or cache. */
export function captureProjectCacheScope(
  userId: Accessor<string | undefined>,
  cacheHost: () => CacheHost | undefined
) {
  const viewer = userId();
  const host = cacheHost();
  const generation =
    host?.authority?.snapshot()?.generation ?? UNKNOWN_CACHE_GENERATION;
  const [valid, setValid] = createSignal(true);
  const unsubscribe = host?.onCacheGenerationChanged((change) => {
    if (change.storage === 'reset') setValid(false);
  });
  return {
    generation,
    viewer,
    host,
    isCurrent: () => valid() && viewer === userId() && host === cacheHost(),
    dispose: () => unsubscribe?.(),
  };
}
