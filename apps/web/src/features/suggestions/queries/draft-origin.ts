import { useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { queryReadyGate } from '@queries/gate';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { type DraftOrigin, draftOrigin } from '../core/suggestion';
import { useSuggestionsFlag } from '../use-suggestions-flag';
import { feedOptions } from './suggestions-source';

/**
 * Where a saved reply draft came from, as the person's feed says. It reads
 * the For you page's own feed entry, once where that page hasn't lately, and
 * never polls: a thread needs what was true when it opened. Nothing is read
 * while suggestions are off.
 */
export function useDraftOrigin(
  draftId: Accessor<string>
): Accessor<DraftOrigin | undefined> {
  const enabled = useSuggestionsFlag();
  const userId = useUserId();
  const feed = useQuery(() => ({
    ...feedOptions(userId() ?? '', enabled() && userId() !== undefined, false),
    refetchInterval: false as const,
  }));

  // The feed is rebuilt on every read: an origin that didn't change keeps
  // its object, so its source links aren't rebuilt under the composer.
  return createMemo(
    () =>
      // Guarded: an unguarded read of a pending query suspends the thread.
      // A feed cached while suggestions were on says nothing once they are off.
      enabled() && queryReadyGate(feed)
        ? draftOrigin(feed.data, draftId())
        : undefined,
    undefined,
    { equals: deepEqual }
  );
}
