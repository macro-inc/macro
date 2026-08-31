/**
 * Per-draft coalescer for durable GraphQL draft saves.
 *
 * The offline mutation queue is strict FIFO with no dedup, and a stuck head
 * blocks every queued mutation in the app — so a typing session must never
 * grow the queue linearly with debounce ticks. The contract here: at most
 * one queued-but-unsettled save per draft in steady state; newer content
 * waits in memory (latest wins) and dispatches when the outstanding save
 * settles, on a lifecycle edge (composer unmount, page hidden), or after a
 * bounded hold so a crash loses at most that window.
 *
 * Module-level state on purpose: the composer unmounts and remounts around
 * the mobile drawer, and the unmount flush and the next mount's saves must
 * share one view of what is outstanding — including the permanent-failure
 * latch, which has to outlive the composer that observed the failure.
 */

import {
  type DeleteEmailDraftOutcome,
  executeGraphqlDeleteEmailDraft,
  executeGraphqlSaveEmailDraft,
  type GraphqlDeleteEmailDraftArgs,
  type GraphqlSaveEmailDraftArgs,
  type SaveEmailDraftOutcome,
} from '@service-storage/graphql-email-draft';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';

/** Upper bound on how long buffered content may wait before dispatching. */
const PENDING_HOLD_MS = 30_000;

/**
 * Result of one submission: dispatched now, held behind an unsettled save,
 * or refused because an earlier save for this draft failed permanently.
 */
export type DraftSaveSubmission =
  | SaveEmailDraftOutcome
  | { kind: 'buffered' }
  | { kind: 'latched'; message: string };

/** Settlement of a previously queued save, as seen by the composer. */
export type DraftSaveSettlement =
  | { status: 'committed' }
  /** Post-settlement failures carry only the resolver's message — the
   * machine-readable code does not survive the queue's settlement channel. */
  | { status: 'failed'; message: string };

type DraftEntry = {
  unsettledTx?: string;
  pending?: GraphqlSaveEmailDraftArgs;
  holdTimer?: ReturnType<typeof setTimeout>;
  onSettlement?: (settlement: DraftSaveSettlement) => void;
  /**
   * Message of a permanent failure. Set once and never cleared: the server
   * rejected this draft id, so replaying the same upsert would fail the same
   * way. Scoped to the id, which is the right scope — a discarded draft is
   * replaced by a freshly minted id, not by re-enabling this one.
   */
  failure?: string;
};

const entries = new Map<string, DraftEntry>();
let unsubscribeSettlements: (() => void) | undefined;
let lifecycleListenersInstalled = false;

function entryFor(draftId: string): DraftEntry {
  let entry = entries.get(draftId);
  if (!entry) {
    entry = {};
    entries.set(draftId, entry);
  }
  return entry;
}

function clearHoldTimer(entry: DraftEntry): void {
  if (entry.holdTimer !== undefined) clearTimeout(entry.holdTimer);
  entry.holdTimer = undefined;
}

function ensureSettlementSubscription(): void {
  if (unsubscribeSettlements) return;
  const host = getGraphqlSoupCacheHost();
  if (!host) return;
  unsubscribeSettlements = host.onMutationSettled((settlement) => {
    for (const [draftId, entry] of entries) {
      if (entry.unsettledTx !== settlement.transactionId) continue;
      entry.unsettledTx = undefined;
      if (settlement.status === 'committed') {
        entry.onSettlement?.({ status: 'committed' });
        const pending = entry.pending;
        if (pending) {
          entry.pending = undefined;
          clearHoldTimer(entry);
          void dispatch(draftId, pending);
        }
      } else {
        // A permanent failure must not auto-re-dispatch: replaying the same
        // save would fail the same way and block the app-wide queue. The
        // latch lives here rather than in the composer because the composer
        // may already be unmounted, and its remount would otherwise resume
        // autosaving straight back into the same rejection.
        entry.failure = settlement.error;
        entry.pending = undefined;
        clearHoldTimer(entry);
        entry.onSettlement?.({
          status: 'failed',
          message: settlement.error,
        });
      }
      break;
    }
  });
}

function ensureLifecycleListeners(): void {
  if (lifecycleListenersInstalled || typeof window === 'undefined') return;
  lifecycleListenersInstalled = true;
  // On mobile, backgrounding precedes virtually every app kill — flush every
  // buffered save so the durable queue holds the final content.
  const flushAll = () => {
    for (const draftId of entries.keys()) {
      void flushPendingDraftSave(draftId);
    }
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

async function dispatch(
  draftId: string,
  args: GraphqlSaveEmailDraftArgs
): Promise<SaveEmailDraftOutcome> {
  const entry = entryFor(draftId);
  const outcome = await executeGraphqlSaveEmailDraft(
    getGraphqlSoupClient(),
    args
  );
  if (outcome.kind === 'queued') {
    entry.unsettledTx = outcome.transactionId;
    ensureSettlementSubscription();
  } else if (outcome.kind === 'committed' && entry.pending) {
    const pending = entry.pending;
    entry.pending = undefined;
    clearHoldTimer(entry);
    void dispatch(draftId, pending);
  } else if (outcome.kind === 'failed') {
    // The caller handles the failure; buffered content stays in the editor.
    entry.pending = undefined;
    clearHoldTimer(entry);
  }
  return outcome;
}

/**
 * Submit a draft save. Dispatches immediately unless an earlier save for
 * this draft is queued and unsettled, in which case the args are buffered
 * latest-wins and dispatched on settlement, on a lifecycle flush, or after
 * the bounded hold. `force` dispatches even while unsettled — used by
 * lifecycle edges (composer unmount) that accept a temporarily deeper queue
 * so the durable layer holds the final content.
 *
 * A draft latched by an earlier permanent failure is refused outright,
 * `force` included: the lifecycle flush must not push a known-doomed save
 * back into the app-wide queue either.
 */
export async function submitDraftSave(
  args: GraphqlSaveEmailDraftArgs,
  options: { force?: boolean } = {}
): Promise<DraftSaveSubmission> {
  ensureLifecycleListeners();
  const draftId = String(args.draftId);
  const entry = entryFor(draftId);
  if (entry.failure !== undefined) {
    return { kind: 'latched', message: entry.failure };
  }
  if (entry.unsettledTx && !options.force) {
    entry.pending = args;
    if (entry.holdTimer === undefined) {
      entry.holdTimer = setTimeout(() => {
        entry.holdTimer = undefined;
        void flushPendingDraftSave(draftId);
      }, PENDING_HOLD_MS);
    }
    return { kind: 'buffered' };
  }
  return dispatch(draftId, args);
}

/**
 * Dispatch any buffered content now, even while an earlier save is still
 * unsettled — a lifecycle edge accepts a temporarily deeper queue so the
 * durable layer holds the final content.
 */
export async function flushPendingDraftSave(draftId: string): Promise<void> {
  const entry = entries.get(draftId);
  if (!entry?.pending) return;
  const pending = entry.pending;
  entry.pending = undefined;
  clearHoldTimer(entry);
  await dispatch(draftId, pending);
}

/** Drop buffered content for a draft that was sent or discarded. */
export function cancelPendingDraftSave(draftId: string): void {
  const entry = entries.get(draftId);
  if (!entry) return;
  entry.pending = undefined;
  clearHoldTimer(entry);
}

/**
 * Discard a draft through the durable queue. Drops any buffered save first —
 * a discard supersedes unsent content — and then enqueues the delete, which
 * FIFO lands after any still-unsettled save of the same draft, so
 * save-then-discard replays in order and converges to no draft. A latched
 * draft may still be deleted: discarding a doomed id is exactly the way out
 * of the latch (the next draft mints a fresh id).
 */
export async function submitDraftDelete(
  args: GraphqlDeleteEmailDraftArgs
): Promise<DeleteEmailDraftOutcome> {
  const entry = entries.get(String(args.draftId));
  if (entry) {
    entry.pending = undefined;
    clearHoldTimer(entry);
  }
  return executeGraphqlDeleteEmailDraft(getGraphqlSoupClient(), args);
}

/**
 * Observe settlements of this draft's queued saves. One observer per draft:
 * the composer currently editing it. Returns an unsubscribe.
 *
 * A settlement can land with no composer mounted — the unmount flush
 * force-dispatches, so that is the ordinary case rather than an edge — and a
 * recorded permanent failure is replayed synchronously to a subscriber that
 * arrives afterwards. A composer that remounts onto a latched draft
 * therefore still learns that its saves are refused.
 */
export function onDraftSaveSettlement(
  draftId: string,
  callback: (settlement: DraftSaveSettlement) => void
): () => void {
  const entry = entryFor(draftId);
  entry.onSettlement = callback;
  if (entry.failure !== undefined) {
    callback({ status: 'failed', message: entry.failure });
  }
  return () => {
    if (entry.onSettlement === callback) entry.onSettlement = undefined;
  };
}
