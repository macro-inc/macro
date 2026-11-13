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
  type OperationResult,
} from '@urql/core';
import { filter, makeSubject, merge, onPush, pipe } from 'wonka';
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
 * such a read behind a cached result waits for them (at most
 * {@link LIVE_UPDATES_HOLD_MS}), so nothing published between its response
 * and the subscriptions starting is lost. A read with nothing cached to show
 * goes at once and is read again once they are live. Its registration then
 * says `followsLiveUpdates: true`, and the first connection does not read it
 * again. Only a read that reaches the network on mount qualifies: a
 * `cache-first` hit has no read to wait.
 */
export const FOLLOWS_LIVE_UPDATES = { followsLiveUpdates: true } as const;

/** The longest a read waits for the first connection's subscriptions. */
export const LIVE_UPDATES_HOLD_MS = 1_000;

type HoldOutcome =
  | 'live'
  | 'timed_out'
  | 'unverified'
  | 'disposed'
  | 'cache_miss';

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
   * reads that waited and went out just now, and of the reads that went out
   * early and are read again now: every reader of those keys sees a read sent
   * after the subscriptions started.
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
  /** Each read that went out before the subscriptions, with its key. */
  const early = new Map<(again: boolean) => void, number>();

  const stopBound = () => {
    clearTimeout(bound);
    bound = undefined;
  };
  const release = (outcome: HoldOutcome): number[] => {
    stopBound();
    const released = [...holds];
    holds.clear();
    for (const [resume] of released) resume(outcome);
    return released.map(([, key]) => key);
  };
  const takeEarly = () => {
    const taken = [...early];
    early.clear();
    return taken;
  };
  const live = (outcome: 'live' | 'unverified') => {
    if (state === 'live' || state === 'disposed') return;
    const stale = state === 'released' || outcome === 'unverified';
    state = 'live';
    const sent = new Set(release(outcome));
    // A read of the same key that waited covers one that went out early.
    for (const [settle, key] of takeEarly()) {
      settle(!stale && !sent.has(key));
      sent.add(key);
    }
    options.onLive(stale, sent);
  };

  return {
    /** Whether a read that follows live updates waits now. */
    holding: () => state === 'waiting',
    /** Whether the subscriptions have gone live (and `onLive` has run). */
    wentLive: () => state === 'live',
    /**
     * Calls `resume` once the held read of operation `key` may go. The bound
     * runs from the first read that waits while any does; when it ends every
     * read goes, and later ones are not held.
     */
    hold(key: number, resume: (outcome: HoldOutcome) => void): () => void {
      holds.set(resume, key);
      bound ??= setTimeout(() => {
        bound = undefined;
        if (state !== 'waiting') return;
        state = 'released';
        release('timed_out');
        // The stale live reads everything again.
        for (const [settle] of takeEarly()) settle(false);
      }, holdMs);
      return () => {
        holds.delete(resume);
      };
    },
    /**
     * The cache had nothing to show for operation `key`, so its held reads
     * go now, with `cache_miss`: waiting would only delay the first answer.
     */
    missed(key: number) {
      if (state !== 'waiting') return;
      for (const [resume, heldKey] of [...holds]) {
        if (heldKey !== key) continue;
        holds.delete(resume);
        resume('cache_miss');
      }
      if (holds.size === 0) stopBound();
    },
    /**
     * A read of operation `key` went out before the subscriptions started.
     * Once they are live, `settle(true)` asks for it to be read again;
     * `settle(false)` says it need not be: a held read of `key` went out
     * then, or every reader reads again (a stale live), or the gate was
     * disposed.
     */
    sentEarly(key: number, settle: (again: boolean) => void): () => void {
      if (state !== 'waiting') {
        settle(false);
        return () => undefined;
      }
      early.set(settle, key);
      return () => {
        early.delete(settle);
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
      for (const [settle] of takeEarly()) settle(false);
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

/**
 * A query whose read went out before the subscriptions started. Once they are
 * live it is read again, after every request sent for it has answered and the
 * client has the last answer, so the newer answer is the one that stays.
 */
type EarlyRead = {
  operation: Operation;
  /** Requests sent for it that have not answered. */
  pending: number;
  /**
   * An answer came back that has not reached the client: the normalized
   * cache publishes it only once written, and urql drops another read of the
   * query until then.
   */
  unpublished: boolean;
  /** From the live that asked for the read again until it answers. */
  reread?: Span;
  rereadSent: boolean;
  cancel: () => void;
};

function operationSpan(name: string, operation: Operation): Span {
  return Telemetry.span(name, {
    sampling: 'perf',
    attributes: {
      'graphql.operation.name': getOperationName(operation.query) ?? 'unknown',
    },
  });
}

function waitSpan(operation: Operation): Span {
  return operationSpan('graphql_soup.live_updates.wait', operation);
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
 * The two exchanges that read the queries marked {@link FOLLOWS_LIVE_UPDATES}
 * around `gate`. `holds` goes after the normalized cache, so a cached result
 * still shows at once: it holds their network reads while `gate` waits, and
 * sends them, in order, when it opens. A read the cache reports as a miss
 * ({@link LiveUpdatesGate.missed}) goes at once instead, and is read again
 * once the subscriptions are live. Without a cache, or with one that starts
 * empty (`cached: false`), every such read is a miss. `rereads` goes first,
 * where results reach the client, and sends that second read only once the
 * client has the first one's answer. A client needs both.
 */
export function liveUpdatesGateExchanges(
  gate: LiveUpdatesGate,
  options: { cached?: boolean } = {}
): { rereads: Exchange; holds: Exchange } {
  const cached = options.cached ?? true;
  const early = new Map<number, EarlyRead>();
  let reexecute: (operation: Operation) => void = () => undefined;

  const forget = (key: number) => {
    const read = early.get(key);
    if (!read) return;
    early.delete(key);
    read.cancel();
    read.reread?.end();
  };
  const rereadIfAnswered = (read: EarlyRead) => {
    if (!read.reread || read.rereadSent) return;
    if (read.pending > 0 || read.unpublished) return;
    read.rereadSent = true;
    const { operation, reread } = read;
    reexecute(
      makeOperation('query', operation, {
        ...operation.context,
        requestPolicy: 'network-only',
        [TRACE_PARENT_CONTEXT_KEY]: firstRequestIn(reread),
      })
    );
  };
  const sentEarly = (operation: Operation) => {
    const { key } = operation;
    const current = early.get(key);
    if (current) {
      current.operation = operation;
      current.pending += 1;
      return;
    }
    const read: EarlyRead = {
      operation,
      pending: 1,
      unpublished: false,
      rereadSent: false,
      cancel: () => undefined,
    };
    early.set(key, read);
    read.cancel = gate.sentEarly(key, (again) => {
      read.cancel = () => undefined;
      if (early.get(key) !== read) return;
      if (!again) {
        forget(key);
        return;
      }
      read.reread = operationSpan(
        'graphql_soup.live_updates.reread',
        read.operation
      );
      read.reread.setAttr(
        'live_updates.answer_pending',
        read.pending > 0 || read.unpublished
      );
      rereadIfAnswered(read);
    });
  };

  const rereads: Exchange = ({ client, forward }) => {
    reexecute = (operation) => client.reexecuteOperation(operation);
    return (operations$) =>
      pipe(
        forward(operations$),
        // urql takes the read again once this result reaches it, before the
        // reexecution it schedules goes out.
        onPush((result) => {
          const read = early.get(result.operation.key);
          if (!read?.unpublished || result.hasNext) return;
          read.unpublished = false;
          rereadIfAnswered(read);
        })
      );
  };

  const holds: Exchange =
    ({ forward }) =>
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
      const answered = (result: OperationResult) => {
        const read = early.get(result.operation.key);
        if (!read || result.hasNext) return;
        if (read.rereadSent) {
          forget(result.operation.key);
          return;
        }
        read.pending = Math.max(0, read.pending - 1);
        read.unpublished = true;
      };
      const hold = (operation: Operation) => {
        const read: HeldRead = {
          operations: [startWait(operation)],
          cancel: () => undefined,
        };
        held.set(operation.key, read);
        read.cancel = gate.hold(operation.key, (outcome) => {
          read.cancel = () => undefined;
          for (const released of finish(operation.key, outcome)) {
            if (outcome === 'cache_miss') sentEarly(released.operation);
            send(resumed(released));
          }
        });
      };

      const passed$ = pipe(
        operations$,
        filter((operation) => {
          if (operation.kind === 'teardown') {
            finish(operation.key, 'torn_down');
            forget(operation.key);
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
          if (!cached) {
            sentEarly(operation);
            return true;
          }
          hold(operation);
          return false;
        })
      );
      return pipe(forward(merge([passed$, resumed$])), onPush(answered));
    };

  return { rereads, holds };
}
