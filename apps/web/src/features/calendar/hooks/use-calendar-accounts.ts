import { useUserId } from '@core/context/user';
import {
  calendarConsentScopes,
  calendarStoppedSyncing,
} from '@core/email-link/consent';
import { useEmailLinksQuery } from '@queries/email/link';
import type { ConsentScopes } from '@service-auth/client';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { createMemo } from 'solid-js';

/** The one calendar action a connected account offers from the calendar view. */
type CalendarAccountAction = 'enable' | 'reconnect' | 'turnOff';

/** A viewer-owned inbox rendered as a manageable calendar account. */
export interface CalendarAccount {
  linkId: string;
  provider: EmailLink['provider'];
  emailAddress: string;
  action: CalendarAccountAction;
  /** A `reconnect` for a calendar that used to sync and lost its access. */
  stoppedSyncing: boolean;
  consentScopes: ConsentScopes;
}

/**
 * Classifies the viewer's own inboxes into one calendar action each. An inbox
 * that needs a full reconnect offers `reconnect`, whether or not its grant
 * still has calendar access, as the calendar view does; its consent asks for
 * the mailbox and calendar together. Otherwise missing calendar access — never
 * granted, declined, or turned off — offers `enable`, and an inbox that already
 * has it offers `turnOff`. An inbox whose calendar used to sync and lost its
 * capability ({@link calendarStoppedSyncing}) offers `reconnect` instead of
 * `enable`, marked `stoppedSyncing`: its events are gone until it re-grants.
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
    .map((link) => {
      const stoppedSyncing = calendarStoppedSyncing(link);
      return {
        linkId: link.id,
        provider: link.provider,
        emailAddress: link.email_address,
        consentScopes: calendarConsentScopes(link),
        stoppedSyncing,
        action:
          link.needs_reauth || stoppedSyncing
            ? 'reconnect'
            : link.needs_calendar_permission
              ? 'enable'
              : 'turnOff',
      };
    });
}

/** Reactive {@link toCalendarAccounts} over the current email links. */
export function useCalendarAccounts() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo<CalendarAccount[]>(() =>
    toCalendarAccounts(
      linksQuery.isSuccess ? linksQuery.data.links : [],
      userId()
    )
  );
}

/**
 * {@link useCalendarAccounts} for callers that must not suspend: `undefined`
 * until the email links have loaded.
 */
export function useLoadedCalendarAccounts() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo<CalendarAccount[] | undefined>(() =>
    linksQuery.isPending || !linksQuery.data
      ? undefined
      : toCalendarAccounts(linksQuery.data.links, userId())
  );
}
