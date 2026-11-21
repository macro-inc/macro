import type { MessageCursor } from '@service-storage/messages';

const MICROS_DIGITS = 20;
const FRACTION_DIGITS = 6;
const TIMESTAMP_FRACTION = /\.(\d+)/;
const ROOT_SORT_KEY = /^(\d{20})-([0-9a-f-]{36})$/;
/** Replies without an import order sort after imported ones. */
const LIVE_REPLY_ORDER = '~';

export const CHANNEL_MESSAGE_TYPENAME = 'GraphqlChannelMessage';
export const CHANNEL_ACTIVITY_TYPENAME = 'GraphqlChannelTimelineActivity';

export const channelMessageKey = (id: string) =>
  `${CHANNEL_MESSAGE_TYPENAME}:${id}`;

export const channelActivityKey = (id: string) =>
  `${CHANNEL_ACTIVITY_TYPENAME}:${id}`;

/**
 * Microseconds since the epoch of an RFC 3339 timestamp. `Date` keeps only
 * milliseconds, and the server orders by the stored microseconds.
 */
export function timestampMicros(timestamp: string): bigint | undefined {
  const seconds = Date.parse(timestamp.replace(TIMESTAMP_FRACTION, ''));
  if (Number.isNaN(seconds)) return undefined;
  const fraction = (TIMESTAMP_FRACTION.exec(timestamp)?.[1] ?? '')
    .slice(0, FRACTION_DIGITS)
    .padEnd(FRACTION_DIGITS, '0');
  return BigInt(seconds) * 1000n + BigInt(fraction);
}

/**
 * The server's sort key of a root message or activity: its position in the
 * channel timeline. Undefined when the timestamp cannot be read.
 */
export function rootSortKey(createdAt: string, id: string): string | undefined {
  const micros = timestampMicros(createdAt);
  if (micros === undefined || micros < 0n) return undefined;
  return `${micros.toString().padStart(MICROS_DIGITS, '0')}-${id.toLowerCase()}`;
}

export function sortKeyFromCursor(cursor: MessageCursor): string | undefined {
  return rootSortKey(cursor.created_at, cursor.id);
}

/** The REST cursor naming the same position as a root sort key. */
export function cursorFromSortKey(sortKey: string): MessageCursor | undefined {
  const match = ROOT_SORT_KEY.exec(sortKey);
  if (!match) return undefined;
  const micros = BigInt(match[1]);
  const date = new Date(Number(micros / 1000n));
  if (Number.isNaN(date.getTime())) return undefined;
  const subMillis = (micros % 1000n).toString().padStart(3, '0');
  return {
    created_at: date.toISOString().replace('Z', `${subMillis}Z`),
    id: match[2],
  };
}

/**
 * How far past its own time a message the server has not placed yet sorts.
 * Larger than any gap between this device's clock and the server's.
 */
const UNPLACED_AHEAD_MICROS = 366n * 24n * 60n * 60n * 1_000_000n;

/**
 * The sort key of a message this device sent and the server has not placed.
 * The server gives a message the time it arrives, which is later than the
 * time it was written and than every message already placed, so until then
 * the message sorts after all placed ones, in the order it was written.
 */
export function unplacedSortKey(
  createdAt: string,
  id: string,
  reply: boolean
): string | undefined {
  const micros = timestampMicros(createdAt);
  if (micros === undefined || micros < 0n) return undefined;
  const position = `${(micros + UNPLACED_AHEAD_MICROS)
    .toString()
    .padStart(MICROS_DIGITS, '0')}-${id.toLowerCase()}`;
  return reply ? `${LIVE_REPLY_ORDER}-${position}` : position;
}
