import { onCleanup } from 'solid-js';
import { OPENING_GRACE_MS } from '../core/channel-stacks';

// When each channel was last left in this page, so reads made during that
// visit never count as unread at the next one.
const leftAt = new Map<string, number>();

/**
 * The time from which a read still counts as unread at this channel's open:
 * shortly before it mounted, to cover a Home or inbox row that marked its
 * stack read on the click that opened it, but never before the channel was
 * last left. Call it as the channel mounts; leaving records the time.
 */
export function createChannelVisit(channelId: string) {
  const openedAt = Date.now();
  const unreadSince = Math.max(
    openedAt - OPENING_GRACE_MS,
    leftAt.get(channelId) ?? 0
  );
  onCleanup(() => leftAt.set(channelId, Date.now()));
  return unreadSince;
}
