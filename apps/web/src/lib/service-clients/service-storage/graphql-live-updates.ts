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
   * readers must read again.
   */
  onLive: (stale: boolean) => void;
}) {
  const holdMs = options.holdMs ?? LIVE_UPDATES_HOLD_MS;
  let state: GateState = 'waiting';
  let connection = 0;
  let pinged = false;
  let bound: ReturnType<typeof setTimeout> | undefined;
  const holds = new Set<(outcome: HoldOutcome) => void>();

  const release = (outcome: HoldOutcome) => {
    clearTimeout(bound);
    bound = undefined;
    const released = [...holds];
    holds.clear();
    for (const resume of released) resume(outcome);
  };
  const live = (outcome: 'live' | 'unverified') => {
    if (state === 'live' || state === 'disposed') return;
    const stale = state === 'released' || outcome === 'unverified';
    state = 'live';
    release(outcome);
    options.onLive(stale);
  };

  return {
    /** Whether a read that follows live updates waits now. */
    holding: () => state === 'waiting',
    /**
     * Calls `resume` once a held read may go. The first held read starts the
     * bound, after which every read goes and later ones are not held.
     */
    hold(resume: (outcome: HoldOutcome) => void): () => void {
      holds.add(resume);
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

type HeldRead = {
  operation: Operation;
  /** The original operation's trace, which starting the wait span used up. */
  parent?: TraceContext;
  span: Span;
  cancel: () => void;
};

function startWait(operation: Operation): Pick<HeldRead, 'parent' | 'span'> {
  const traceParent: TraceContext | undefined =
    operation.context[TRACE_PARENT_CONTEXT_KEY];
  const start = () => {
    const span = Telemetry.span('graphql_soup.live_updates.wait', {
      sampling: 'perf',
      attributes: {
        'graphql.operation.name':
          getOperationName(operation.query) ?? 'unknown',
      },
    });
    return { span, parent: Telemetry.captureContext() };
  };
  if (!traceParent) return { span: start().span };
  const { span, parent } = traceParent.run(start);
  return { span, parent: firstRequestIn(parent) };
}

function resumed(read: HeldRead): Operation {
  const { operation, parent } = read;
  if (!parent) return operation;
  return makeOperation(operation.kind, operation, {
    ...operation.context,
    [TRACE_PARENT_CONTEXT_KEY]: parent,
  });
}

/**
 * After the normalized cache, so a cached result still shows at once: holds
 * the network reads of queries marked {@link FOLLOWS_LIVE_UPDATES} while
 * `gate` waits, keeping the latest operation per query, and sends them when
 * it opens.
 */
export function liveUpdatesGateExchange(gate: LiveUpdatesGate): Exchange {
  return ({ forward }) =>
    (operations$) => {
      const { source: resumed$, next: send } = makeSubject<Operation>();
      const held = new Map<number, HeldRead>();

      const finish = (key: number, outcome: HoldOutcome | 'torn_down') => {
        const read = held.get(key);
        if (!read) return undefined;
        held.delete(key);
        read.cancel();
        read.span.setAttr('live_updates.outcome', outcome);
        read.span.end();
        return read;
      };
      const hold = (operation: Operation) => {
        const read: HeldRead = {
          operation,
          ...startWait(operation),
          cancel: () => undefined,
        };
        held.set(operation.key, read);
        read.cancel = gate.hold((outcome) => {
          read.cancel = () => undefined;
          const released = finish(operation.key, outcome);
          if (released) send(resumed(released));
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
            // A re-execution replaces the held read, with its own trace.
            read.operation = operation;
            read.parent = undefined;
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
