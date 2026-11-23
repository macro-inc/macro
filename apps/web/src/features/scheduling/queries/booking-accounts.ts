import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useEmailLinksQuery, usePrimaryEmailLinkId } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo } from 'solid-js';
import type { BookingAccount } from '../core/booking-account';

/**
 * One account per connected inbox whose primary calendar the user can write,
 * in the order the event composer lists calendars: the primary inbox first.
 * The scheduling service books on the same set.
 */
export function useBookingAccounts(): Accessor<BookingAccount[]> {
  const calendarsQuery = useVisibleCalendarsQuery();
  const linksQuery = useEmailLinksQuery();
  const primaryLinkId = usePrimaryEmailLinkId();
  return createMemo(() => {
    // Reading a pending query would suspend the editor around it.
    if (!queryReadyGate(calendarsQuery)) return [];
    const links = queryReadyGate(linksQuery) ? linksQuery.data.links : [];
    const accounts: BookingAccount[] = [];
    for (const calendar of calendarsQuery.data) {
      if (
        !calendar.isPrimary ||
        !calendar.isWritable ||
        accounts.some((account) => account.emailLinkId === calendar.emailLinkId)
      )
        continue;
      accounts.push({
        emailLinkId: calendar.emailLinkId,
        emailAddress: calendar.emailAddress,
        primary: calendar.emailLinkId === primaryLinkId(),
        needsReconnect: links.some(
          (link) => link.id === calendar.emailLinkId && link.needs_reauth
        ),
        videoMeetings: !!calendar.capabilities.conferenceProvider,
      });
    }
    return accounts;
  });
}
