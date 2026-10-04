import type { CacheHost } from '@graphql-cache/host/types';
import { type Accessor, createSignal } from 'solid-js';

/** Async REST bridges must not publish into a replacement viewer or cache. */
export function captureProjectCacheScope(
  userId: Accessor<string | undefined>,
  cacheHost: () => CacheHost | undefined
) {
  const viewer = userId();
  const host = cacheHost();
  const [valid, setValid] = createSignal(true);
  const unsubscribe = host?.onCacheGenerationChanged((change) => {
    if (change.storage === 'reset') setValid(false);
  });
  return {
    viewer,
    host,
    isCurrent: () => valid() && viewer === userId() && host === cacheHost(),
    dispose: () => unsubscribe?.(),
  };
}

export type ProjectCacheScope = ReturnType<typeof captureProjectCacheScope>;
