import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableContactLists,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';

/** Whether the reads that write contacts to the local cache also select
 * `GraphqlContact.lists`. Off (and while flags load) they select exactly what
 * they did before the field existed. Read it per request, never at mount. */
export function contactListsSelected(): boolean {
  return isFeatureEnabled(enableContactLists);
}

/** The same answer as a signal that changes only when the answer does, so a
 * flag that finishes loading as off restarts nothing. */
export function useContactListsSelected(): Accessor<boolean> {
  const flag = useFeatureFlag(enableContactLists);
  return createMemo(() => flag().enabled);
}
