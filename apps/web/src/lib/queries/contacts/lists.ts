import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableContactLists,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import {
  type ContactListPriority,
  MENTION_LIST_PRIORITY,
} from './list-priority';

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

/** The list order a personal mention window passes: the default order while
 * `enable-contact-lists` is on, none while it is off or loading, which keeps
 * today's order. */
export function useMentionListPriority(): Accessor<
  ContactListPriority | undefined
> {
  const selected = useContactListsSelected();
  return () => (selected() ? MENTION_LIST_PRIORITY : undefined);
}
