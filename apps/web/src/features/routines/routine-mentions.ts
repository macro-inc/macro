import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type { RoutineMentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { enableRoutineSharing } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import { createLazyMemo } from '@solid-primitives/memo';
import type { Accessor } from 'solid-js';
import { useSchedulesQuery } from './queries/schedules';

/**
 * The viewer's own routines for a channel's mention menu. Only an owner can
 * share a routine, so nobody else's are offered.
 */
export function useRoutineMentionSource(
  searchTerm: Accessor<string>,
  enabled: Accessor<boolean>
): Accessor<RoutineMentionItem[]> {
  const sharing = useFeatureFlag(enableRoutineSharing);
  const userId = useUserId();
  const active = () => enabled() && sharing().enabled;
  const query = useSchedulesQuery(active);
  return createLazyMemo(() => {
    if (!active() || !queryReadyGate(query)) return [];
    const term = searchTerm().trim().toLocaleLowerCase();
    return query.data.flatMap((routine) =>
      routine.id &&
      routine.owner === userId() &&
      routine.name.toLocaleLowerCase().includes(term)
        ? [
            {
              kind: 'routine' as const,
              id: routine.id,
              data: { id: routine.id, name: routine.name },
            },
          ]
        : []
    );
  });
}
