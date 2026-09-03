import { useUserId } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { createMemo } from 'solid-js';

/** The one calendar action a connected account offers from the calendar view. */
type CalendarAccountAction = 'enable' | 'turnOff';

/** A viewer-owned inbox rendered as a manageable calendar account. */
export interface CalendarAccount {
  linkId: string;
  emailAddress: string;
  action: CalendarAccountAction;
}

/**
 * Classifies the viewer's own inboxes into one calendar action each. An inbox
 * whose Google grant is missing calendar access — never granted, declined, or
 * turned off — offers `enable`; one that already has it offers `turnOff`. A
 * legacy inbox that still has data but no longer satisfies the capability check
 * also reads as `enable`: re-granting resumes it, and removing the stale data
 * stays available from connection settings.
 *
 * Delegated inboxes are dropped: the viewer reads the owner's calendar but must
 * not enable or delete the owner's calendar from here. The viewer's primary
 * inbox sorts first; the rest keep the links list's order.
 */
export function toCalendarAccounts(
  links: readonly EmailLink[],
  userId: string | undefined
): CalendarAccount[] {
  return links
    .filter((link) => link.macro_id === userId)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((link) => ({
      linkId: link.id,
      emailAddress: link.email_address,
      action: link.needs_calendar_permission ? 'enable' : 'turnOff',
    }));
}

/** Reactive {@link toCalendarAccounts} over the current email links. */
export function useCalendarAccounts() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo<CalendarAccount[]>(() =>
    toCalendarAccounts(linksQuery.data?.links ?? [], userId())
  );
}
