import type { EventType } from './types';

/** A connected inbox whose primary calendar a personal booking link can book on. */
export type BookingAccount = {
  emailLinkId: string;
  emailAddress: string;
  primary: boolean;
  /** The inbox lost its grant, so links booking on it take no bookings. */
  needsReconnect: boolean;
  /** Its calendar can add a video meeting (Google Meet or Microsoft Teams). */
  videoMeetings: boolean;
};

/**
 * The account a personal link books on: the one it names, or the primary
 * inbox's when it names none. Undefined while accounts load, when the named
 * inbox is no longer connected, and for a link on the primary inbox when
 * that inbox has no calendar it can book on.
 */
export function bookingAccountFor(
  event: Pick<EventType, 'emailLinkId'>,
  accounts: readonly BookingAccount[]
): BookingAccount | undefined {
  if (!event.emailLinkId) return accounts.find((account) => account.primary);
  return accounts.find((account) => account.emailLinkId === event.emailLinkId);
}

/**
 * The account to show for a personal link: its address, "Primary account"
 * for a link on a primary inbox that isn't listed, or that the inbox it
 * names is gone. Undefined while accounts load, and when there is nothing to
 * choose: the primary inbox is the only account and the link names none.
 */
export function bookingAccountLabel(
  event: Pick<EventType, 'emailLinkId'>,
  accounts: readonly BookingAccount[]
): string | undefined {
  if (!accounts.length) return undefined;
  const account = bookingAccountFor(event, accounts);
  if (!event.emailLinkId) {
    if (accounts.length === 1 && account) return undefined;
    return account?.emailAddress ?? PRIMARY_ACCOUNT_LABEL;
  }
  return account?.emailAddress ?? 'Disconnected account';
}

/** A link on the primary inbox, when that inbox lists no bookable calendar. */
export const PRIMARY_ACCOUNT_LABEL = 'Primary account';

/** Why a personal link cannot book on the account it names, if it cannot. */
export function bookingAccountIssue(
  event: Pick<EventType, 'emailLinkId' | 'googleMeet'>,
  accounts: readonly BookingAccount[]
): string | undefined {
  if (!event.emailLinkId || !accounts.length) return undefined;
  const account = bookingAccountFor(event, accounts);
  if (!account)
    return 'This account is no longer connected. Choose another account for bookings.';
  if (event.googleMeet && !account.videoMeetings)
    return `${account.emailAddress} can't add video meetings. Choose a Macro call or a custom location.`;
  return undefined;
}
