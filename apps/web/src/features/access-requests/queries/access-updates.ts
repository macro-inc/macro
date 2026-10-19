import { useIsAuthenticated } from '@core/auth';
import { useAccessRequestState } from '@queries/access-requests/requests';
import { type Accessor, createEffect, createMemo, on } from 'solid-js';
import type { AccessLevel, ShareEntity } from '../core/types';

/**
 * Bridges refreshed server access to a host's existing permission adapter.
 * The previous level is undefined until this entity has confirmed access.
 */
export function useSharedAccessUpdates(
  entity: Accessor<ShareEntity | undefined>,
  apply: (
    level: AccessLevel | null,
    previous: AccessLevel | null | undefined
  ) => void
) {
  const authenticated = useIsAuthenticated();
  const state = useAccessRequestState(entity, () => !!authenticated());
  const confirmed = createMemo<
    { key: string; level: AccessLevel | null } | undefined
  >((previous) => {
    const target = entity();
    if (!authenticated() || !target) return;
    const key = `${target.entityType}:${target.entityId}`;
    if (state.isSuccess && state.isFetchedAfterMount)
      return { key, level: state.data.accessLevel ?? null };
    // A failed refresh cannot restore permissions after confirmed revocation.
    return previous?.key === key ? previous : undefined;
  });
  createEffect(
    on(confirmed, (current, previous) => {
      if (current)
        apply(
          current.level,
          previous?.key === current.key ? previous.level : undefined
        );
    })
  );
  return () => confirmed()?.level;
}
