import { deadlineReached, deferredGate } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import type { WALSyncer } from '@macro-inc/collaboration/collab/wal';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';

/**
 * What the viewer should be told about the session's link to the server:
 * - `unsaved`: their edits have been waiting for the server too long, so
 *   collaborators can't see them and they live only on this device.
 * - `offline`: the session has been disconnected too long, so the viewer may
 *   not be seeing collaborators' latest changes. It lasts until the document
 *   has caught up again, not just until the socket reopens.
 */
export type CollabSyncProblem = 'unsaved' | 'offline';

export type CollabSyncHealth = {
  problem: Accessor<CollabSyncProblem | undefined>;
  /** Reconnects if disconnected and resends the pending edits. */
  retry: () => void;
};

/** How long edits may wait, or the session stay disconnected, before the
 *  viewer is told. Long enough to ride out a reconnect or a slow ack. */
export const SYNC_PROBLEM_DELAY_MS = 10_000;

type SyncHealthOptions = {
  status: Accessor<SyncSourceStatus>;
  /** Calls the listener each time the document has caught up with the server
   *  after a reconnect; returns the unsubscribe. */
  onResync: (listener: () => void) => () => void;
  /** A viewer who can't edit can't send their pending edits either, so they
   *  are not told about them. */
  canEdit: Accessor<boolean>;
  wal: Pick<WALSyncer<unknown>, 'pendingSince' | 'onPendingChange' | 'flush'>;
  reconnect: () => void;
  delay?: number;
};

/** Derives the session's {@link CollabSyncProblem}. Each problem appears only
 *  after it has lasted `delay`, and clears as soon as it is resolved. */
export function createCollabSyncHealth(
  options: SyncHealthOptions
): CollabSyncHealth {
  const delay = options.delay ?? SYNC_PROBLEM_DELAY_MS;
  const [pendingSince, setPendingSince] = createSignal(
    options.wal.pendingSince()
  );
  onCleanup(options.wal.onPendingChange(setPendingSince));

  const unsaved = deadlineReached(() => {
    const since = pendingSince();
    return since === undefined ? undefined : since + delay;
  });
  const [resyncs, setResyncs] = createSignal(0);
  onCleanup(options.onResync(() => setResyncs((count) => count + 1)));
  // Down from when the link drops until the document has caught up after it
  // comes back. A memo, so the gate sees one change per outage, not a restart
  // of its timer on every Connecting/Disconnected step of a reconnect loop.
  let resyncsAtDrop = 0;
  const disconnected = createMemo((was: boolean) => {
    const count = resyncs();
    if (options.status() !== SyncSourceStatus.Connected) {
      resyncsAtDrop = count;
      return true;
    }
    return was && count === resyncsAtDrop;
  }, false);
  const offline = deferredGate(disconnected, delay);

  return {
    problem: () => {
      if (options.canEdit() && unsaved()) return 'unsaved';
      if (offline()) return 'offline';
      return undefined;
    },
    retry: () => {
      options.reconnect();
      fireAndForget(options.wal.flush(), 'collab-sync-retry');
    },
  };
}
