import { CombinedError } from '@urql/core';
import { refreshChannelViews } from './catch-up';

/** How long after each device fault in a row the channel is read again. */
export const REREAD_DELAYS_MS = [2_000, 6_000, 15_000] as const;
/** A fault this long after the last one starts a new row. */
export const FAULT_ROW_MS = 5 * 60_000;

type FaultRow = {
  rereads: number;
  lastFaultAt: number;
  waiting?: ReturnType<typeof setTimeout>;
};

const faultRows = new Map<string, FaultRow>();

/**
 * Whether a failed read says the device could not answer: a worker that timed
 * out or a host that failed. The server refusing or not being reached is not
 * one; the same read made again would only fail again.
 */
export function isDeviceFault(error: unknown): boolean {
  return !(error instanceof CombinedError);
}

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
  const row: FaultRow =
    known && now - known.lastFaultAt < FAULT_ROW_MS
      ? known
      : { rereads: 0, lastFaultAt: now };
  row.lastFaultAt = now;
  faultRows.set(channelId, row);
  if (row.waiting !== undefined) return;
  const delay = REREAD_DELAYS_MS[row.rereads];
  if (delay === undefined) return;
  row.rereads += 1;
  row.waiting = setTimeout(() => {
    row.waiting = undefined;
    refreshChannelViews(channelId);
  }, delay);
}

/** Drops the rereads still to come: they belong to the account they were noted for. */
export function resetRereads(): void {
  for (const row of faultRows.values()) clearTimeout(row.waiting);
  faultRows.clear();
}
