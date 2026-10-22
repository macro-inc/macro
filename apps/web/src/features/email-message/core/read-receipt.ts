import type { EmailMessage } from './email-message';
import { formatShortDateTime } from './format-email-date';

/** Open tracking for one of the viewer's sent messages. */
export interface ReadReceipt {
  openCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
}

/** An inbox the viewer owns or is a delegate of, with its send-as aliases. */
export interface ViewerInbox {
  id: string;
  email_address: string;
  sendAs?: readonly { email_address: string }[] | null;
}

const PIXEL_PATH = '/opens/';

/** URL prefixes of read-receipt pixels served by these email-service hosts. */
export function readReceiptPixelPrefixes(hosts: readonly string[]): string[] {
  return hosts.map((host) => `${host.replace(/\/+$/, '')}${PIXEL_PATH}`);
}

/** Only a recipient reading their own copy counts as an open. The sender's
 * copies stay hidden, including one they received by CC'ing themselves, as do
 * copies seen only through sharing and every copy while inboxes load. */
export function showsReadReceiptPixel(
  message: Pick<EmailMessage, 'link_id' | 'from' | 'labels'>,
  inboxes: readonly ViewerInbox[]
): boolean {
  if (!inboxes.some((inbox) => inbox.id === message.link_id)) return false;
  // Gmail labels the sender's copy even when its alias lookup failed.
  if (message.labels.some((label) => label.provider_label_id === 'SENT'))
    return false;
  const from = message.from?.email.toLowerCase();
  if (!from) return true;
  return !inboxes.some(
    (inbox) =>
      inbox.email_address.toLowerCase() === from ||
      inbox.sendAs?.some((alias) => alias.email_address.toLowerCase() === from)
  );
}

export function readReceiptLabel(receipt: ReadReceipt): string {
  return receipt.openCount > 0 ? 'Opened' : 'Not opened';
}

export function readReceiptDetail(receipt: ReadReceipt): string {
  const { openCount, firstOpenedAt, lastOpenedAt } = receipt;
  if (openCount === 0 || !lastOpenedAt) return 'Not opened yet';
  const last = formatShortDateTime(lastOpenedAt);
  if (openCount === 1 || !firstOpenedAt) return `Opened ${last}`;
  return `Opened ${openCount} times · first ${formatShortDateTime(firstOpenedAt)} · last ${last}`;
}
