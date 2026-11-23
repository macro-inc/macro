/**
 * Counts, per host, the commits this page sends that delete what a channel
 * holds: a reset of one channel, or an eviction of any. A server fill marks
 * the count before it fetches and commits its coverage only if it is
 * unchanged when the commit is sent: coverage committed after such a delete
 * would describe records the delete already removed, and the device would
 * then show a covered, empty stretch. The host applies commits in the order
 * they are sent, so a delete sent after the coverage removes it too.
 *
 * Deletes sent by another tab's runtime are not counted here.
 */
type Counts = { all: number; channels: Map<string, number> };

const counts = new WeakMap<object, Counts>();

function countsOf(host: object): Counts {
  let entry = counts.get(host);
  if (!entry) {
    entry = { all: 0, channels: new Map() };
    counts.set(host, entry);
  }
  return entry;
}

/** The delete count for a channel; compare it with `unchangedSince`. */
export function channelResetMark(host: object, channelId: string): string {
  const entry = countsOf(host);
  return `${entry.all}:${entry.channels.get(channelId) ?? 0}`;
}

/** Whether nothing deleted the channel's records since `mark`. */
export function unchangedSince(
  host: object,
  channelId: string,
  mark: string
): boolean {
  return channelResetMark(host, channelId) === mark;
}

/** Call right before sending a commit that deletes the channel's records. */
export function noteChannelReset(host: object, channelId: string): void {
  const entry = countsOf(host);
  entry.channels.set(channelId, (entry.channels.get(channelId) ?? 0) + 1);
}

/** Call right before sending an eviction, which can take any channel. */
export function noteChannelsEvicted(host: object): void {
  countsOf(host).all += 1;
}
