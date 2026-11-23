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
 * inbox's when it names none. Undefined while accounts load, or when the
 * named inbox is no longer connected.
 */
export function bookingAccountFor(
  event: Pick<EventType, 'emailLinkId'>,
  accounts: readonly BookingAccount[]
): BookingAccount | undefined {
  if (!event.emailLinkId)
    return accounts.find((account) => account.primary) ?? accounts[0];
  return accounts.find((account) => account.emailLinkId === event.emailLinkId);
}

/**
 * The account to show for a personal link: its address, or that the inbox it
 * names is gone. Undefined while accounts load, and when there is nothing to
 * choose: one account, and the link names none.
 */
export function bookingAccountLabel(
  event: Pick<EventType, 'emailLinkId'>,
  accounts: readonly BookingAccount[]
): string | undefined {
  if (!accounts.length) return undefined;
  if (accounts.length < 2 && !event.emailLinkId) return undefined;
  return (
    bookingAccountFor(event, accounts)?.emailAddress ?? 'Disconnected account'
  );
}

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
