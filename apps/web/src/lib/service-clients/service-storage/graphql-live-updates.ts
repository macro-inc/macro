import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import {
  type Exchange,
  getOperationName,
  makeOperation,
  type Operation,
} from '@urql/core';
import { filter, makeSubject, merge, pipe } from 'wonka';
import {
  firstRequestIn,
  joinsCallerTrace,
  TRACE_PARENT_CONTEXT_KEY,
} from '../../urql-solid/trace-parent-exchange';

declare module '@urql/core' {
  interface OperationContext {
    /** See {@link FOLLOWS_LIVE_UPDATES}. */
    followsLiveUpdates?: boolean;
  }
}

/**
 * Query context for a read that the Soup websocket's subscriptions keep
 * current: one whose view registers an activity revalidator or a channel
 * notification reader. Until the first connection's subscriptions are live,
 * such a read waits for them (at most {@link LIVE_UPDATES_HOLD_MS}), so
 * nothing published between its response and the subscriptions starting is
 * lost. Its registration then says `followsLiveUpdates: true`, and the first
 * connection does not read it again. Only a read that reaches the network on
 * mount qualifies: a `cache-first` hit has no read to wait.
 */
export const FOLLOWS_LIVE_UPDATES = { followsLiveUpdates: true } as const;

/** The longest a read waits for the first connection's subscriptions. */
export const LIVE_UPDATES_HOLD_MS = 1_000;

type HoldOutcome = 'live' | 'timed_out' | 'unverified' | 'disposed';

type GateState = 'waiting' | 'released' | 'live' | 'disposed';

export type LiveUpdatesGate = ReturnType<typeof createLiveUpdatesGate>;

/**
 * Tracks when one websocket client's subscriptions first start hearing
 * events, and holds reads that follow them until then.
 *
 * The server keeps no backlog: an event published before a subscription is
 * registered never reaches it. On acknowledgement graphql-ws sends every
 * subscribe frame in the following microtasks, so a ping sent a task later
 * follows them on the socket. The server registers the subscriptions it has
 * read before it reads the ping, and polls them right after answering it, so
 * a read sent after the pong arrives sees everything they will not deliver.
 */
export function createLiveUpdatesGate(options: {
  holdMs?: number;
  /**
   * The subscriptions are live. `stale` when reads that follow them went out
   * earlier (the hold timed out, or the socket could not be pinged), so their
   * readers must read again. Otherwise `sent` holds the operation keys of the
   * reads that waited and went out just now: every reader of those keys sees
   * a read sent after the subscriptions started.
   */
  onLive: (stale: boolean, sent: ReadonlySet<number>) => void;
}) {
  const holdMs = options.holdMs ?? LIVE_UPDATES_HOLD_MS;
  let state: GateState = 'waiting';
  let connection = 0;
  let pinged = false;
  let bound: ReturnType<typeof setTimeout> | undefined;
  /** Each held read's resume, with its operation key. */
  const holds = new Map<(outcome: HoldOutcome) => void, number>();

  const release = (outcome: HoldOutcome): ReadonlySet<number> => {
    clearTimeout(bound);
    bound = undefined;
    const released = [...holds];
    holds.clear();
    for (const [resume] of released) resume(outcome);
    return new Set(released.map(([, key]) => key));
  };
  const live = (outcome: 'live' | 'unverified') => {
    if (state === 'live' || state === 'disposed') return;
    const stale = state === 'released' || outcome === 'unverified';
    state = 'live';
    const sent = release(outcome);
    options.onLive(stale, sent);
  };

  return {
    /** Whether a read that follows live updates waits now. */
    holding: () => state === 'waiting',
    /**
     * Calls `resume` once the held read of operation `key` may go. The first
     * held read starts the bound, after which every read goes and later ones
     * are not held.
     */
    hold(key: number, resume: (outcome: HoldOutcome) => void): () => void {
      holds.set(resume, key);
      bound ??= setTimeout(() => {
        bound = undefined;
        if (state !== 'waiting') return;
        state = 'released';
        release('timed_out');
      }, holdMs);
      return () => {
        holds.delete(resume);
      };
    },
    /**
     * The server acknowledged a connection. `ping` sends a ping whose pong
     * reaches {@link pong}, returning false when the socket cannot be pinged.
     */
    connected(ping: () => boolean) {
      if (state === 'live' || state === 'disposed') return;
      connection += 1;
      const current = connection;
      pinged = false;
      setTimeout(() => {
        if (current !== connection) return;
        if (ping()) pinged = true;
        else live('unverified');
      }, 0);
    },
    pong(received: boolean) {
      if (received && pinged) live('live');
    },
    closed() {
      connection += 1;
      pinged = false;
    },
    dispose() {
      if (state === 'disposed') return;
      state = 'disposed';
      connection += 1;
      release('disposed');
    },
  };
}

type HeldOperation = {
  operation: Operation;
  /** The trace the operation's query started in, which the wait used up. */
  parent?: TraceContext;
  span?: Span;
};

/**
 * Every operation dispatched for one query while it waits, in order. The
 * normalized cache counts each one it forwards as a request in flight until
 * its result arrives, so the gate sends them all, as it would have unheld.
 */
type HeldRead = { operations: HeldOperation[]; cancel: () => void };

function waitSpan(operation: Operation): Span {
  return Telemetry.span('graphql_soup.live_updates.wait', {
    sampling: 'perf',
    attributes: {
      'graphql.operation.name': getOperationName(operation.query) ?? 'unknown',
    },
  });
}

/**
 * Starts the wait span in the trace the operation's query started in, and
 * keeps a fresh context there for its request. An operation whose trace a
 * request already joined (a re-sent operation) has no trace of its own to
 * wait in: like any re-sent operation it goes out without one, unrecorded.
 */
function startWait(operation: Operation): HeldOperation {
  const traceParent: TraceContext | undefined =
    operation.context[TRACE_PARENT_CONTEXT_KEY];
  if (!traceParent) return { operation, span: waitSpan(operation) };
  if (!joinsCallerTrace(traceParent)) return { operation };
  return traceParent.run(() => ({
    operation,
    span: waitSpan(operation),
    parent: firstRequestIn(Telemetry.captureContext()),
  }));
}

function resumed({ operation, parent }: HeldOperation): Operation {
  if (!parent) return operation;
  return makeOperation(operation.kind, operation, {
    ...operation.context,
    [TRACE_PARENT_CONTEXT_KEY]: parent,
  });
}

/**
 * After the normalized cache, so a cached result still shows at once: holds
 * the network reads of queries marked {@link FOLLOWS_LIVE_UPDATES} while
 * `gate` waits, and sends them, in order, when it opens. It only delays: what
 * reaches the transport is what would have without it.
 */
export function liveUpdatesGateExchange(gate: LiveUpdatesGate): Exchange {
  return ({ forward }) =>
    (operations$) => {
      const { source: resumed$, next: send } = makeSubject<Operation>();
      const held = new Map<number, HeldRead>();

      const finish = (key: number, outcome: HoldOutcome | 'torn_down') => {
        const read = held.get(key);
        if (!read) return [];
        held.delete(key);
        read.cancel();
        for (const { span } of read.operations) {
          span?.setAttr('live_updates.outcome', outcome);
          span?.end();
        }
        return read.operations;
      };
      const hold = (operation: Operation) => {
        const read: HeldRead = {
          operations: [startWait(operation)],
          cancel: () => undefined,
        };
        held.set(operation.key, read);
        read.cancel = gate.hold(operation.key, (outcome) => {
          read.cancel = () => undefined;
          for (const released of finish(operation.key, outcome))
            send(resumed(released));
        });
      };

      const passed$ = pipe(
        operations$,
        filter((operation) => {
          if (operation.kind === 'teardown') {
            finish(operation.key, 'torn_down');
            return true;
          }
          if (
            operation.kind !== 'query' ||
            operation.context.followsLiveUpdates !== true
          )
            return true;
          const read = held.get(operation.key);
          if (read) {
            read.operations.push(startWait(operation));
            return false;
          }
          if (!gate.holding()) return true;
          hold(operation);
          return false;
        })
      );
      return forward(merge([passed$, resumed$]));
    };
}
