import { addMinutes } from 'date-fns';

/**
 * An invite's email is rate limited to one per this many minutes, so a
 * resend any sooner would be dropped. Mirrors `invite_resend_interval` in the teams
 * crate, which rejects earlier resends.
 */
const INVITE_RESEND_INTERVAL_MINUTES = 60;

/** When an invite last emailed at `lastSentAt` may be emailed again. */
export function inviteResendAvailableAt(lastSentAt: string): Date {
  return addMinutes(new Date(lastSentAt), INVITE_RESEND_INTERVAL_MINUTES);
}

export function canResendInvite(lastSentAt: string, now: Date): boolean {
  return now >= inviteResendAvailableAt(lastSentAt);
}
