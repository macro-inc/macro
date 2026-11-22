import { refreshChannelViews } from './catch-up';

/** How long after each device fault in a row the channel is read again. */
export const REREAD_DELAYS_MS = [2_000, 6_000, 15_000] as const;
/** A fault this long after the last one starts a new row. */
const FAULT_ROW_MS = 60_000;

type FaultRow = { rereads: number; lastFaultAt: number; waiting: boolean };

const faultRows = new Map<string, FaultRow>();

/**
 * Has the open views read a channel again after a read the device could not
 * answer in full: its read failed or timed out and REST answered, or its
 * queue could not be listed. Such an answer cannot carry a write still
 * waiting in the device queue, and nothing else reads again while it waits.
 * A busy device answers late more often than never, so the read is repeated
 * a few times, further apart, and then left alone.
 */
export function rereadAfterDeviceFault(channelId: string): void {
  const now = Date.now();
  const known = faultRows.get(channelId);
  const row =
    known && now - known.lastFaultAt < FAULT_ROW_MS
      ? known
      : { rereads: 0, lastFaultAt: now, waiting: false };
  row.lastFaultAt = now;
  faultRows.set(channelId, row);
  if (row.waiting) return;
  const delay = REREAD_DELAYS_MS[row.rereads];
  if (delay === undefined) return;
  row.rereads += 1;
  row.waiting = true;
  setTimeout(() => {
    row.waiting = false;
    refreshChannelViews(channelId);
  }, delay);
}

/** For tests. */
export function resetRereads(): void {
  faultRows.clear();
}
