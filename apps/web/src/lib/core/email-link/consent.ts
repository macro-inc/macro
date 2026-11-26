import type { ConsentScopes } from '@service-auth/client';
import type { Link } from '@service-email/generated/schemas';

type CalendarAccess = Pick<
  Link,
  | 'needs_reauth'
  | 'needs_calendar_permission'
  | 'calendar_disabled'
  | 'has_calendar_data'
>;

/** Repair the capabilities an inbox used before its Google grant expired. */
export function reconnectScopes(link: CalendarAccess): ConsentScopes {
  return !link.calendar_disabled &&
    (!link.needs_calendar_permission || link.has_calendar_data)
    ? 'gmail_and_calendar'
    : 'gmail';
}

/**
 * A calendar that used to sync and lost its calendar capability. The inbox
 * keeps its calendar account once it has had one — Macro only creates it from
 * a grant with the capability, and a grant without it turns the account off
 * rather than deleting it — so calendar data alongside missing calendar
 * permission tells it apart from a calendar that was never connected. A
 * calendar the user turned off, or an inbox that needs a full reconnect or
 * was disconnected, is not this.
 */
export function calendarStoppedSyncing(
  link: CalendarAccess & Pick<Link, 'is_sync_active'>
): boolean {
  return (
    link.is_sync_active &&
    link.needs_calendar_permission &&
    link.has_calendar_data &&
    !link.calendar_disabled &&
    !link.needs_reauth
  );
}

/** A revoked mailbox needs email permission as well as calendar permission. */
export function calendarConsentScopes(
  link: Pick<Link, 'needs_reauth'>
): ConsentScopes {
  return link.needs_reauth ? 'gmail_and_calendar' : 'calendar';
}

/** Preselect the account named by the reconnect/enable action at Google. */
export function inboxAuthorizationUrl(
  url: string,
  emailAddress?: string
): string {
  if (!emailAddress) return url;
  const authorizationUrl = new URL(url);
  authorizationUrl.searchParams.set('login_hint', emailAddress);
  return authorizationUrl.toString();
}
