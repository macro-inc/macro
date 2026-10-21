import { formatShortDateTime } from './format-email-date';

/** Open tracking for one of the viewer's sent messages. */
export interface ReadReceipt {
  openCount: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
}

const PIXEL_PATH = '/opens/';

/** URL prefixes of read-receipt pixels served by these email-service hosts. */
export function readReceiptPixelPrefixes(hosts: readonly string[]): string[] {
  return hosts.map((host) => `${host.replace(/\/+$/, '')}${PIXEL_PATH}`);
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
