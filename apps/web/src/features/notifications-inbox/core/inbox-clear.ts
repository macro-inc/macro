import { clearIncludes, type InboxClear } from './inbox-filters';
import type { InboxRowType } from './inbox-row';

/**
 * Where a clear is in its life on the server. A status this build doesn't
 * know reads as `applying`: the clear is still at work.
 */
export type InboxClearStatus =
  | 'applying'
  | 'done'
  | 'undoing'
  | 'undone'
  | 'failed';

/**
 * A clear as the server stores it: what it takes, frozen when it started,
 * and how far it has got. The server works through it on its own, so it
 * finishes without this tab.
 */
export type InboxClearState = {
  id: string;
  status: InboxClearStatus;
  /** The rows it takes. */
  takes: InboxClear;
  /** When it started (epoch ms); what arrived later is not cleared. */
  asOf: number;
  /** Rows cleared so far. */
  rows: number;
  /** Grows with every change; an older copy is dropped. */
  revision: number;
};

/** Whether the server still has work to do on the clear or its undo. */
export const isClearRunning = (status: InboxClearStatus): boolean =>
  status === 'applying' || status === 'undoing';

/**
 * Whether a clear still at work hides a row: one it takes, whose newest
 * notification had arrived when it started. Its rows are hidden at once,
 * on every device, rather than as the server reaches each.
 */
export function clearHides(
  clear: InboxClearState,
  row: { type: InboxRowType | 'other'; unseen: boolean; latestAt: number }
): boolean {
  return (
    clear.status === 'applying' &&
    row.latestAt <= clear.asOf &&
    clearIncludes(clear.takes, row)
  );
}

/** `clears` with `next` in place, unless a newer copy is already held. */
export function withClear(
  clears: readonly InboxClearState[],
  next: InboxClearState
): readonly InboxClearState[] {
  const held = clears.find((clear) => clear.id === next.id);
  if (held && held.revision > next.revision) return clears;
  return [...clears.filter((clear) => clear.id !== next.id), next];
}
