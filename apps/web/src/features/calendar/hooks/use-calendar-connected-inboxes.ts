import { useUserId } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { createMemo } from 'solid-js';

/**
 * The viewer's own inboxes whose calendar Macro can still remove, in the order
 * the links list returns them. Delegated inboxes are excluded: the viewer can
 * read the owner's calendar but must not be able to delete the owner's data.
 *
 * An inbox needing reauth still counts, and so does one whose grant no longer
 * satisfies today's capability check — in both cases its events are still in
 * Macro, and turning calendar off is the way to remove them.
 */
export function useCalendarConnectedInboxes() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo<EmailLink[]>(() =>
    (linksQuery.data?.links ?? []).filter(
      (link) =>
        link.macro_id === userId() &&
        (!link.needs_calendar_permission || link.has_calendar_data)
    )
  );
}
