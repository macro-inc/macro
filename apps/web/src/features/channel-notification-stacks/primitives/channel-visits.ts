import { onCleanup } from 'solid-js';
import { OPENING_GRACE_MS } from '../core/channel-stacks';

/** A channel mounted again this soon after unmounting was moved, not left. */
const REMOUNT_MS = 2_000;

type Visit = { unreadSince: number; leftAt?: number };

// Each channel's last visit in this page, so reads made during it never count
// as unread at the next one.
const visits = new Map<string, Visit>();

/**
 * The time from which a read still counts as unread at this channel's open:
 * shortly before it mounted, to cover a Home or inbox row that marked its
 * stack read on the click that opened it, but never before the channel was
 * last left. A remount right after an unmount (a split moved, a preview
 * opened in a split) continues the visit. Call it as the channel mounts.
 */
export function createChannelVisit(channelId: string) {
  const openedAt = Date.now();
  const previous = visits.get(channelId);
  const continues =
    previous?.leftAt !== undefined && openedAt - previous.leftAt < REMOUNT_MS;
  const visit: Visit = {
    unreadSince: continues
      ? previous.unreadSince
      : Math.max(openedAt - OPENING_GRACE_MS, previous?.leftAt ?? 0),
  };
  visits.set(channelId, visit);
  onCleanup(() => {
    visit.leftAt = Date.now();
  });
  return visit.unreadSince;
}
