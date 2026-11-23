import type { CacheHost } from '@graphql-cache/host/types';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';

type ScopeHost = Pick<CacheHost, 'onCacheGenerationChanged'>;

/** Per-observer fence shared by directory windows and explicit selections. */
export function createContactQueryEpoch<H extends ScopeHost>(
  scope: Accessor<{ userId?: string; host?: H }>,
  onReset?: () => void
) {
  const [epoch, setEpoch] = createSignal(0);
  const invalidate = () => {
    setEpoch((value) => value + 1);
  };
  const reset = () =>
    batch(() => {
      onReset?.();
      invalidate();
    });
  let previous = untrack(scope);
  createEffect(() => {
    const current = scope();
    if (current.userId !== previous.userId || current.host !== previous.host)
      reset();
    previous = current;
    if (current.host) onCleanup(current.host.onCacheGenerationChanged(reset));
  });
  return { epoch, invalidate };
}
