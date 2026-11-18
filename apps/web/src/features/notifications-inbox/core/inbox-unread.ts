import type { InboxRowType } from './inbox-row';

/** How many unread rows of one kind the whole inbox holds. */
export type InboxUnreadCount = {
  /** `other` is a kind this build doesn't know: it counts in no section. */
  type: InboxRowType | 'other';
  /**
   * The rows are vault access requests, which the inbox lists only for
   * viewers who have the vault.
   */
  passwordRequests: boolean;
  count: number;
};

/** The highest count shown as a number; past it the label is `99+`. */
const HIGHEST_SHOWN = 99;

/** The channel rows: what the Channels view's notifications are. */
export const CHANNEL_ROW_TYPES: readonly InboxRowType[] = [
  'channel_mention',
  'channel_messages',
  'channel_thread',
];

/** The mail rows: what the Mail view's notifications are. */
export const MAIL_ROW_TYPES: readonly InboxRowType[] = ['email'];

/**
 * Unread rows the inbox lists for this viewer, of `rowTypes` when given.
 * Vault access requests count only with `passwords`, as the inbox hides
 * them otherwise.
 */
export function unreadRows(
  counts: readonly InboxUnreadCount[],
  options: { rowTypes?: readonly InboxRowType[]; passwords: boolean }
): number {
  let total = 0;
  for (const entry of counts) {
    if (entry.passwordRequests && !options.passwords) continue;
    if (
      options.rowTypes &&
      (entry.type === 'other' || !options.rowTypes.includes(entry.type))
    ) {
      continue;
    }
    total += entry.count;
  }
  return total;
}

/** The label beside a section: nothing at zero, `99+` past ninety-nine. */
export function unreadLabel(count: number | undefined): string | undefined {
  if (count === undefined || count <= 0) return undefined;
  if (count > HIGHEST_SHOWN) return `${HIGHEST_SHOWN}+`;
  return String(count);
}
