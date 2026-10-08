/**
 * The class against a mocked worker client and harness client: inputs reach
 * the machine in order with the snapshot first, an issued action is
 * speculated before its POST and settled by the answer, and the last release
 * closes the machine.
 */

import type { FoldInput } from '@core/agent-fold/client';
import type { FoldedStreamEvent } from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const fold = vi.hoisted(() => ({
  pushSession: vi.fn(),
  readSession: vi.fn(),
  closeSession: vi.fn(),
}));
const harness = vi.hoisted(() => ({
  get: vi.fn(),
  control: vi.fn(),
}));
const logSource = vi.hoisted(() => {
  class Unavailable extends Error {
    constructor(
      readonly sessionId: string,
      readonly reason: 'inaccessible' | 'failed'
    ) {
      super(`agent session log is ${reason}: ${sessionId}`);
    }
  }
  type Follow = {
    rows: (rows: AgentSessionLogEntryDto[]) => void;
    gap: () => void;
  };
  const source = {
    Unavailable,
    cached: vi.fn(),
    cacheMiss: vi.fn(),
    fetched: vi.fn(),
    forget: vi.fn(),
    watch: vi.fn(),
    stop: vi.fn(),
    /** Whether the client can follow the log over GraphQL. */
    following: false,
    /** The follow the latest watch was opened with, when following. */
    follow: undefined as Follow | undefined,
  };
  source.watch.mockImplementation(
    (_id: string, _policy?: string, follow?: Follow) => {
      source.follow = follow;
      return {
        cached: source.cached(),
        cacheMiss: source.cacheMiss,
        fetched: source.fetched(),
        stop: source.stop,
      };
    }
  );
  return source;
});
const soupSocket = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  subscribeGraphqlSoupReconnected: (listener: () => void) => {
    soupSocket.listeners.add(listener);
    return () => soupSocket.listeners.delete(listener);
  },
}));
const socket = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  subscribeSocketSessionStarted: vi.fn((listener: () => void) => {
    socket.listeners.add(listener);
    return () => socket.listeners.delete(listener);
  }),
}));

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  ends: number;
};
const telemetry = vi.hoisted(() => ({
  spans: [] as RecordedSpan[],
  /** The span whose `run` is on the stack, if any. */
  active: undefined as RecordedSpan | undefined,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (name: string) => {
      const record: RecordedSpan = { name, attributes: {}, ends: 0 };
      telemetry.spans.push(record);
      return {
        setAttr: (key: string, value: unknown) => {
          record.attributes[key] = value;
        },
        event: () => {},
        error: () => {},
        run: <T>(operation: () => T) => {
          const outer = telemetry.active;
          telemetry.active = record;
          try {
            return operation();
          } finally {
            telemetry.active = outer;
          }
        },
        end: () => {
          record.ends += 1;
        },
      };
    },
  },
}));
const promptSpans = () =>
  telemetry.spans.filter((span) => span.name === 'agent.prompt');
const loadSpans = () =>
  telemetry.spans.filter((span) => span.name === 'agent.session.load');
const renderSpans = () =>
  telemetry.spans.filter((span) => span.name === 'agent.session.render');

const updates = vi.hoisted(() => ({
  listeners: new Set<(event: { agentSessionId: string }) => void>(),
}));
vi.mock('@queries/agent-session/session-metadata-sync', () => ({
  subscribeAgentSessionUpdated: (
    listener: (event: { agentSessionId: string }) => void
  ) => {
    updates.listeners.add(listener);
    return () => updates.listeners.delete(listener);
  },
}));
function invalidate(id = SESSION) {
  for (const listener of updates.listeners) listener({ agentSessionId: id });
}

vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeSocketSessionStarted: socket.subscribeSocketSessionStarted,
}));
vi.mock('@queries/agent-session/log', () => ({
  AgentSessionLogUnavailable: logSource.Unavailable,
  watchAgentSessionLog: logSource.watch,
  canFollowAgentSessionLog: () => logSource.following,
  forgetAgentSessionLog: logSource.forget,
}));

import {
  AgentSession,
  AgentSessionAccessDenied,
  AgentSessionReleased,
} from './AgentSession';
import { forgetSessionCreated, markSessionCreated } from './recently-created';
import { resetSessionTurns, sessionTurn } from './session-turn';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';

function row(n: number): AgentSessionLogEntryDto {
  return {
    id: `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    createdAt: new Date(Date.UTC(2026, 7, 13, 0, 0, n)).toISOString(),
    direction: 'to_server',
    content: { type: 'acp', jsonrpc: '2.0', id: n },
  } as unknown as AgentSessionLogEntryDto;
}

const bot = { id: 'bot-id', name: 'Agent', handle: 'agent' };
const session = { id: SESSION, name: 'A session', canEdit: true };
type LogSnapshot = { bot: typeof bot; rows: AgentSessionLogEntryDto[] };
const logOf = (rows: AgentSessionLogEntryDto[]): LogSnapshot => ({
  bot,
  rows,
});

/** Every input the worker saw, flattened across pushes. */
const inputs = (): FoldInput[] =>
  fold.pushSession.mock.calls.flatMap((call) => call[1] as FoldInput[]);

/** Let awaited promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A deferred the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionTurns();
  telemetry.spans.length = 0;
  socket.listeners.clear();
  updates.listeners.clear();
  // Instances are shared and refcounted, so a test that fails before its
  // `release()` would hand the next one a session that is already loaded.
  for (
    let leaked = AgentSession.get(SESSION);
    leaked;
    leaked = AgentSession.get(SESSION)
  ) {
    leaked.release();
  }
  fold.pushSession.mockResolvedValue([]);
  fold.readSession.mockResolvedValue({ messages: [], metadata: {} });
  harness.get.mockResolvedValue(ok(session));
  logSource.cached.mockResolvedValue(undefined);
  logSource.fetched.mockResolvedValue(logOf([row(1)]));
  logSource.following = false;
  logSource.follow = undefined;
  soupSocket.listeners.clear();
  logSource.forget.mockResolvedValue(undefined);
  harness.control.mockImplementation(
    async (_id: string, request: { actionId: string }) =>
      ok({ actionId: request.actionId, status: 'sent' })
  );
});

describe('AgentSession', () => {
  it('folds the snapshot first, then rows that arrived during the load', async () => {
    const log = deferred<LogSnapshot>();
    logSource.fetched.mockReturnValue(log.promise);

    const live = AgentSession.acquire(SESSION);
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(2)] });
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(3)] });
    log.resolve(logOf([row(1), row(2)]));
    const record = await live.load();

    expect(record).toEqual({ session, bot });
    expect(inputs()).toEqual([
      { kind: 'snapshot', rows: [row(1), row(2)] },
      { kind: 'confirmed', row: row(2) },
      { kind: 'confirmed', row: row(3) },
    ]);
    live.release();
  });

  it('names a load abandoned by its last release, rather than failing it', async () => {
    const log = deferred<LogSnapshot>();
    logSource.fetched.mockReturnValue(log.promise);

    const live = AgentSession.acquire(SESSION);
    const loading = live.load();
    // The surface goes away while the log is still on the wire - a list row
    // scrolling out, or a route change - and nothing is left to render it.
    live.release();
    log.resolve(logOf([row(1)]));

    await expect(loading).rejects.toBeInstanceOf(AgentSessionReleased);
    expect(fold.pushSession).not.toHaveBeenCalled();
  });

  it('ignores rows for sessions nobody has open', () => {
    AgentSession.ingest({ agentSessionId: 'other', entries: [row(1)] });
    expect(fold.pushSession).not.toHaveBeenCalled();
  });

  it('speculates before the POST and keeps the id the harness accepted', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    const events: FoldedStreamEvent[][] = [];
    live.subscribe((batch) => events.push(batch));
    const speculated = {
      kind: 'new',
      message: { turn: 1 },
    } as unknown as FoldedStreamEvent;
    fold.pushSession.mockResolvedValueOnce([speculated]);

    const result = await live.issue(
      { type: 'prompt', prompt: 'hi' },
      { userId: 'macro|wolf@macro.com' }
    );

    expect(result.isOk()).toBe(true);
    const [speculation] = inputs().filter(
      (input) => input.kind === 'speculated'
    );
    expect(speculation).toMatchObject({
      kind: 'speculated',
      action: { type: 'prompt', prompt: 'hi' },
      userId: 'macro|wolf@macro.com',
    });
    const actionId = (speculation as { actionId: string }).actionId;
    // The POST carries the speculated id so the harness can accept it.
    expect(harness.control).toHaveBeenCalledWith(SESSION, {
      type: 'prompt',
      prompt: 'hi',
      actionId,
    });
    // Same id back: nothing to reconcile.
    expect(inputs().filter((input) => input.kind === 'retracted')).toEqual([]);
    expect(events).toEqual([[speculated]]);
    live.release();
  });

  it('reissues the speculation under the id the harness minted instead', async () => {
    harness.control.mockResolvedValue(
      ok({ actionId: 'server-id', status: 'sent' })
    );
    const live = AgentSession.acquire(SESSION);
    await live.load();

    await live.issue({ type: 'prompt', prompt: 'hi' });
    await settle();

    const tail = inputs().slice(-3);
    expect(tail[0]).toMatchObject({ kind: 'speculated' });
    const clientId = (tail[0] as { actionId: string }).actionId;
    expect(tail[1]).toEqual({ kind: 'retracted', actionId: clientId });
    expect(tail[2]).toMatchObject({
      kind: 'speculated',
      actionId: 'server-id',
    });
    // The swap is one push, so a listener sees one replace, not a flicker.
    expect(fold.pushSession).toHaveBeenLastCalledWith(SESSION, [
      tail[1],
      tail[2],
    ]);
    live.release();
  });

  it('leaves a stop alone whatever id it was accepted under', async () => {
    harness.control.mockResolvedValue(
      ok({ actionId: 'server-id', status: 'sent' })
    );
    const live = AgentSession.acquire(SESSION);
    await live.load();

    await live.issue({ type: 'stop' });
    await settle();

    expect(inputs().filter((input) => input.kind === 'retracted')).toEqual([]);
    expect(
      inputs().filter((input) => input.kind === 'speculated')
    ).toHaveLength(1);
    live.release();
  });

  it('retracts a speculation the harness refused', async () => {
    harness.control.mockResolvedValue(err([{ code: 'FORBIDDEN' }]));
    const live = AgentSession.acquire(SESSION);
    await live.load();

    const result = await live.issue({ type: 'prompt', prompt: 'hi' });
    await settle();

    expect(result.isErr()).toBe(true);
    const [speculation] = inputs().filter(
      (input) => input.kind === 'speculated'
    );
    expect(inputs().at(-1)).toEqual({
      kind: 'retracted',
      actionId: (speculation as { actionId: string }).actionId,
    });
    live.release();
  });

  it('speculates an elicitation answer like any other action', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();

    await live.issue({
      type: 'respondElicitation',
      requestId: 3,
      action: 'decline',
    });

    expect(
      inputs().filter((input) => input.kind === 'speculated')
    ).toMatchObject([{ action: { type: 'respondElicitation', requestId: 3 } }]);
    expect(inputs().filter((input) => input.kind === 'retracted')).toEqual([]);
    live.release();
  });

  it('retracts a prompt the server only queued', async () => {
    // The harness logs a queued action's row at dispatch, so holding the
    // speculation would show an open turn for the whole wait.
    harness.control.mockImplementation(
      async (_id: string, request: { actionId: string }) =>
        ok({ actionId: request.actionId, status: 'queued' })
    );
    const live = AgentSession.acquire(SESSION);
    await live.load();

    await live.issue({ type: 'prompt', prompt: 'later' });
    await settle();

    const [speculation] = inputs().filter(
      (input) => input.kind === 'speculated'
    );
    expect(inputs().at(-1)).toEqual({
      kind: 'retracted',
      actionId: (speculation as { actionId: string }).actionId,
    });
    live.release();
  });

  it('buffers an action issued before the snapshot behind it', async () => {
    const log = deferred<LogSnapshot>();
    logSource.fetched.mockReturnValue(log.promise);
    const live = AgentSession.acquire(SESSION);

    void live.issue({ type: 'prompt', prompt: 'early' });
    await settle();
    expect(fold.pushSession).not.toHaveBeenCalled();

    log.resolve(logOf([]));
    await live.load();
    expect(inputs().map((input) => input.kind)).toEqual([
      'snapshot',
      'speculated',
    ]);
    live.release();
  });

  it('shares one instance across acquisitions and closes on the last release', async () => {
    const first = AgentSession.acquire(SESSION);
    const second = AgentSession.acquire(SESSION);
    expect(second).toBe(first);
    await first.load();
    expect(logSource.watch).toHaveBeenCalledOnce();

    first.release();
    expect(fold.closeSession).not.toHaveBeenCalled();
    expect(AgentSession.get(SESSION)).toBe(first);
    second.release();
    expect(fold.closeSession).toHaveBeenCalledWith(SESSION);
    expect(AgentSession.get(SESSION)).toBeUndefined();
  });

  it('reloads committed recovery state and preserves frames received during the read', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    const log = deferred<LogSnapshot>();
    logSource.fetched.mockReturnValueOnce(log.promise);
    invalidate('another-session');
    expect(logSource.watch).toHaveBeenCalledTimes(1);
    invalidate();
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(3)] });
    expect(inputs().filter((input) => input.kind === 'confirmed')).toEqual([]);
    log.resolve(logOf([row(1), row(2)]));
    await vi.waitFor(() =>
      expect(inputs().at(-1)).toEqual({ kind: 'confirmed', row: row(3) })
    );
    expect(inputs().slice(-2)).toEqual([
      { kind: 'snapshot', rows: [row(1), row(2)] },
      { kind: 'confirmed', row: row(3) },
    ]);
    live.release();
    expect(updates.listeners.size).toBe(0);
  });

  it('coalesces repeated invalidations and catches one received during initial loading', async () => {
    const first = deferred<LogSnapshot>();
    const refresh = deferred<LogSnapshot>();
    logSource.fetched
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(logOf([row(1), row(2), row(3)]));
    const live = AgentSession.acquire(SESSION);
    invalidate();
    first.resolve(logOf([row(1)]));
    await live.load();
    expect(logSource.watch).toHaveBeenCalledTimes(2);
    invalidate();
    invalidate();
    expect(logSource.watch).toHaveBeenCalledTimes(2);
    refresh.resolve(logOf([row(1), row(2)]));
    await vi.waitFor(() =>
      expect(inputs().at(-1)).toEqual({
        kind: 'snapshot',
        rows: [row(1), row(2), row(3)],
      })
    );
    expect(logSource.watch).toHaveBeenCalledTimes(3);
    live.release();
  });

  it('releases buffered live frames after a failed refresh', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    const refresh = deferred<LogSnapshot>();
    logSource.fetched.mockReturnValueOnce(refresh.promise);
    invalidate();
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(2)] });
    refresh.reject(new logSource.Unavailable(SESSION, 'failed'));
    await vi.waitFor(() =>
      expect(inputs().at(-1)).toEqual({ kind: 'confirmed', row: row(2) })
    );
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(3)] });
    await live.snapshot();
    expect(inputs().at(-1)).toEqual({ kind: 'confirmed', row: row(3) });
    live.release();
  });

  it.each(['result', 'transport'])(
    'retries a failed refresh without blocking live frames (%s)',
    async (failure) => {
      vi.useFakeTimers();
      const live = AgentSession.acquire(SESSION);
      try {
        await live.load();
        if (failure === 'result')
          logSource.fetched.mockRejectedValueOnce(
            new logSource.Unavailable(SESSION, 'failed')
          );
        else logSource.fetched.mockRejectedValueOnce(new Error('network down'));
        logSource.fetched.mockResolvedValueOnce(
          logOf([row(1), row(2), row(3)])
        );
        invalidate();
        await vi.advanceTimersByTimeAsync(0);
        AgentSession.ingest({ agentSessionId: SESSION, entries: [row(2)] });
        await live.snapshot();
        expect(inputs().at(-1)).toEqual({ kind: 'confirmed', row: row(2) });
        expect(logSource.watch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(inputs().at(-1)).toEqual({
          kind: 'snapshot',
          rows: [row(1), row(2), row(3)],
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(logSource.watch).toHaveBeenCalledTimes(3);
      } finally {
        live.release();
        vi.useRealTimers();
      }
    }
  );

  it('bounds failed refresh retries and gives a new invalidation a fresh budget', async () => {
    vi.useFakeTimers();
    const live = AgentSession.acquire(SESSION);
    try {
      await live.load();
      logSource.fetched.mockRejectedValue(
        new logSource.Unavailable(SESSION, 'failed')
      );
      invalidate();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(logSource.watch).toHaveBeenCalledTimes(5);
      invalidate();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(logSource.watch).toHaveBeenCalledTimes(9);
    } finally {
      live.release();
      vi.useRealTimers();
    }
  });

  it('cancels a scheduled refresh retry when the last view releases it', async () => {
    vi.useFakeTimers();
    const live = AgentSession.acquire(SESSION);
    try {
      await live.load();
      logSource.fetched.mockRejectedValue(
        new logSource.Unavailable(SESSION, 'failed')
      );
      invalidate();
      await vi.advanceTimersByTimeAsync(0);
      live.release();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(logSource.watch).toHaveBeenCalledTimes(2);
    } finally {
      if (AgentSession.get(SESSION)) live.release();
      vi.useRealTimers();
    }
  });

  it('does not retry an access-denied refresh', async () => {
    vi.useFakeTimers();
    const live = AgentSession.acquire(SESSION);
    try {
      await live.load();
      logSource.fetched.mockRejectedValue(
        new logSource.Unavailable(SESSION, 'inaccessible')
      );
      invalidate();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(logSource.watch).toHaveBeenCalledTimes(2);
    } finally {
      live.release();
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    'retains optimistic actions during refresh (replacement ID=%s)',
    async (replacement) => {
      if (replacement)
        harness.control.mockResolvedValue(
          ok({ actionId: 'server-id', status: 'sent' })
        );
      const live = AgentSession.acquire(SESSION);
      await live.load();
      const refresh = deferred<LogSnapshot>();
      logSource.fetched.mockReturnValueOnce(refresh.promise);
      invalidate();
      await live.issue({ type: 'prompt', prompt: 'Continue' });
      expect(inputs().filter((input) => input.kind === 'speculated')).toEqual(
        []
      );
      refresh.resolve(logOf([row(1)]));
      await vi.waitFor(() =>
        expect(inputs().at(-1)).toMatchObject({
          kind: 'speculated',
          action: { type: 'prompt', prompt: 'Continue' },
        })
      );
      if (replacement) {
        const issued = harness.control.mock.calls.at(-1)![1].actionId;
        expect(inputs().slice(-2)).toMatchObject([
          { kind: 'retracted', actionId: issued },
          { kind: 'speculated', actionId: 'server-id' },
        ]);
      }
      live.release();
    }
  );

  it('does not recreate a released session when a refresh completes', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    const refresh = deferred<LogSnapshot>();
    logSource.fetched.mockReturnValueOnce(refresh.promise);
    invalidate();
    live.release();
    const before = inputs();
    refresh.resolve(logOf([row(1), row(2)]));
    await settle();
    expect(inputs()).toEqual(before);
    expect(updates.listeners.size).toBe(0);
  });

  it('re-snapshots when the socket reopens', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    logSource.fetched.mockResolvedValue(logOf([row(1), row(2)]));

    for (const listener of socket.listeners) listener();
    await settle();

    expect(inputs().at(-1)).toEqual({
      kind: 'snapshot',
      rows: [row(1), row(2)],
    });
    live.release();
  });

  /** A fold whose turn state is `state` from the moment it loads. */
  const loadedWith = async (state: string) => {
    fold.readSession.mockResolvedValue({
      messages: [],
      metadata: { turn: state },
    });
    const live = AgentSession.acquire(SESSION);
    await live.load();
    return live;
  };

  const speculations = () =>
    inputs().filter((input) => input.kind === 'speculated');

  it.each(['starting', 'running', 'stopping', 'blocked'])(
    'does not speculate a prompt while a turn is %s: the server queues it',
    async (state) => {
      const live = await loadedWith(state);

      const result = await live.issue({ type: 'prompt', prompt: 'later' });

      expect(speculations()).toEqual([]);
      // Still posted - the queue row is what shows it, not a bubble.
      expect(harness.control).toHaveBeenCalledOnce();
      expect(result.isOk()).toBe(true);
      live.release();
    }
  );

  it.each(['idle', 'disconnected'])(
    'speculates a prompt while the session is %s',
    async (state) => {
      const live = await loadedWith(state);

      await live.issue({ type: 'prompt', prompt: 'now' });

      expect(speculations()).toHaveLength(1);
      live.release();
    }
  );

  it('speculates a stop and a model change even mid-turn: both ride alongside', async () => {
    const live = await loadedWith('running');

    await live.issue({ type: 'stop' });
    await live.issue({ type: 'setModel', model: 'sonnet' });
    await settle();

    expect(speculations().map((input) => input.action.type)).toEqual([
      'stop',
      'setModel',
    ]);
    live.release();
  });

  it('follows the turn state through fold events, not just the load', async () => {
    const live = await loadedWith('idle');
    // The agent starts working: the next prompt belongs in the queue.
    fold.pushSession.mockResolvedValueOnce([
      { kind: 'metadata', metadata: { turn: 'running' } },
    ]);
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(2)] });
    await settle();

    await live.issue({ type: 'prompt', prompt: 'later' });

    expect(speculations()).toEqual([]);
    live.release();
  });

  it('publishes the fold turn so list rows can follow a working session', async () => {
    const live = await loadedWith('running');
    expect(sessionTurn(SESSION)).toBe('running');
    fold.pushSession.mockResolvedValueOnce([
      { kind: 'metadata', metadata: { turn: 'idle' } },
    ]);
    AgentSession.ingest({ agentSessionId: SESSION, entries: [row(2)] });
    await settle();
    expect(sessionTurn(SESSION)).toBe('idle');
    live.release();
  });

  it('retracts a speculation the server queued after all', async () => {
    harness.control.mockResolvedValue(
      ok({ actionId: 'server-id', status: 'queued' })
    );
    const live = await loadedWith('idle');

    await live.issue({ type: 'prompt', prompt: 'raced' });
    await settle();

    const [speculation] = speculations();
    expect(inputs().at(-1)).toEqual({
      kind: 'retracted',
      actionId: (speculation as { actionId: string }).actionId,
    });
    live.release();
  });

  it('sends two prompts back to back without speculating the second', async () => {
    const live = await loadedWith('idle');

    // No await between them: the fold's turn state cannot have moved yet, so
    // only the session's own record of what it just folded can catch this.
    const first = live.issue({ type: 'prompt', prompt: 'one' });
    const second = live.issue({ type: 'prompt', prompt: 'two' });
    await Promise.all([first, second]);
    await settle();

    expect(
      speculations().map((input) =>
        input.action.type === 'prompt' ? input.action.prompt : undefined
      )
    ).toEqual(['one']);
    expect(harness.control).toHaveBeenCalledTimes(2);
    live.release();
  });

  it('shows a queued action as dispatched without posting, and takes it back', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    fold.pushSession.mockClear();

    live.expect(
      'head-id',
      { type: 'prompt', prompt: 'next' },
      { userId: 'me' }
    );
    await settle();
    expect(inputs()).toEqual([
      {
        kind: 'speculated',
        actionId: 'head-id',
        action: { type: 'prompt', prompt: 'next' },
        userId: 'me',
      },
    ]);
    expect(harness.control).not.toHaveBeenCalled();

    // The head now occupies the turn, so a prompt sent meanwhile is queued
    // and not speculated.
    fold.pushSession.mockClear();
    await live.issue({ type: 'prompt', prompt: 'later' });
    expect(inputs().filter((input) => input.kind === 'speculated')).toEqual([]);

    live.retract('head-id');
    await settle();
    expect(inputs().at(-1)).toEqual({ kind: 'retracted', actionId: 'head-id' });
    live.release();
  });

  it('names a 401 on the session or its log as denied access', async () => {
    harness.get.mockResolvedValueOnce(err([{ code: 'UNAUTHORIZED' }]));
    const live = AgentSession.acquire(SESSION);
    await expect(live.load()).rejects.toBeInstanceOf(AgentSessionAccessDenied);

    logSource.fetched.mockRejectedValueOnce(
      new logSource.Unavailable(SESSION, 'inaccessible')
    );
    await expect(live.load()).rejects.toBeInstanceOf(AgentSessionAccessDenied);
    live.release();
  });

  describe('a session this tab just created', () => {
    beforeEach(() => {
      markSessionCreated(SESSION);
      onTestFinished(() => forgetSessionCreated(SESSION));
    });

    it('waits out a refusal and loads once the create is readable', async () => {
      vi.useFakeTimers();
      onTestFinished(() => void vi.useRealTimers());
      // The create has answered, but what it wrote is not readable yet.
      harness.get
        .mockResolvedValueOnce(err([{ code: 'UNAUTHORIZED' }]))
        .mockResolvedValue(ok(session));

      const live = AgentSession.acquire(SESSION);
      const loaded = live.load();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(await loaded).toEqual({ session, bot });
      // Nothing was thrown away on the strength of a refusal that was a race.
      expect(logSource.forget).not.toHaveBeenCalled();
      live.release();
    });

    it('waits out a 404 from a create whose row is not visible yet', async () => {
      vi.useFakeTimers();
      onTestFinished(() => void vi.useRealTimers());
      harness.get
        .mockResolvedValueOnce(err([{ code: 'NOT_FOUND' }]))
        .mockResolvedValue(ok(session));

      const live = AgentSession.acquire(SESSION);
      const loaded = live.load();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(await loaded).toEqual({ session, bot });
      live.release();
    });

    it('gives up as a retryable failure, not denied access, if it never clears', async () => {
      vi.useFakeTimers();
      onTestFinished(() => void vi.useRealTimers());
      harness.get.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));

      const live = AgentSession.acquire(SESSION);
      const settled = live.load().catch((error: unknown) => error);
      // Past every retry, but still inside the window in which this tab's
      // creates are given the benefit of the doubt.
      await vi.advanceTimersByTimeAsync(20_000);

      const error = await settled;
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AgentSessionAccessDenied);
      live.release();
    });

    it('reports a refusal honestly once a load has proved the grant is there', async () => {
      const first = AgentSession.acquire(SESSION);
      expect(await first.load()).toEqual({ session, bot });
      first.release();

      // Access taken away after a load that worked is a refusal in earnest,
      // not a create still settling, even inside the grace window.
      harness.get.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
      const second = AgentSession.acquire(SESSION);
      await expect(second.load()).rejects.toBeInstanceOf(
        AgentSessionAccessDenied
      );
      second.release();
    });
  });

  describe('cached log', () => {
    it('folds the cached log first and the fetched one over it', async () => {
      logSource.cached.mockResolvedValue(logOf([row(1), row(2)]));
      const log = deferred<LogSnapshot>();
      logSource.fetched.mockReturnValue(log.promise);

      const live = AgentSession.acquire(SESSION);
      expect(await live.warm()).toEqual({ session, bot });
      expect(inputs()).toEqual([{ kind: 'snapshot', rows: [row(1), row(2)] }]);

      log.resolve(logOf([row(1), row(2), row(3)]));
      expect(await live.load()).toEqual({ session, bot });
      expect(inputs().at(-1)).toEqual({
        kind: 'snapshot',
        rows: [row(1), row(2), row(3)],
      });
      live.release();
    });

    it('holds live rows behind the fetched log while the cached one shows', async () => {
      logSource.cached.mockResolvedValue(logOf([row(1)]));
      const log = deferred<LogSnapshot>();
      logSource.fetched.mockReturnValue(log.promise);

      const live = AgentSession.acquire(SESSION);
      await live.warm();
      // Delivered while the fetch is on the wire. The cached transcript is
      // on screen but frozen: folding this row onto it now could lose it to
      // the fetched snapshot's replace, so it waits behind that snapshot.
      AgentSession.ingest({ agentSessionId: SESSION, entries: [row(3)] });
      await settle();
      expect(inputs()).toEqual([{ kind: 'snapshot', rows: [row(1)] }]);

      log.resolve(logOf([row(1), row(2)]));
      await live.load();
      expect(inputs().slice(1)).toEqual([
        { kind: 'snapshot', rows: [row(1), row(2)] },
        { kind: 'confirmed', row: row(3) },
      ]);
      live.release();
    });

    it('never lets a cached log replace a fetched one that landed first', async () => {
      const read = deferred<unknown>();
      logSource.cached.mockReturnValue(read.promise);

      const live = AgentSession.acquire(SESSION);
      await live.load();
      read.resolve(logOf([row(9)]));

      expect(await live.warm()).toBeUndefined();
      expect(inputs()).toEqual([{ kind: 'snapshot', rows: [row(1)] }]);
      live.release();
    });

    it('stops the watch, and what it owes the cache, on the last release', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();
      expect(logSource.stop).not.toHaveBeenCalled();

      live.release();
      expect(logSource.stop).toHaveBeenCalledOnce();
    });

    it('forgets the cached log when the viewer is refused', async () => {
      logSource.fetched.mockRejectedValueOnce(
        new logSource.Unavailable(SESSION, 'inaccessible')
      );
      const live = AgentSession.acquire(SESSION);
      await expect(live.load()).rejects.toBeInstanceOf(
        AgentSessionAccessDenied
      );
      expect(logSource.forget).toHaveBeenCalledWith(SESSION);
      live.release();
    });
  });

  describe('followed over GraphQL', () => {
    beforeEach(() => {
      logSource.following = true;
    });

    it('folds the rows the subscription delivers and ignores the gateway', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();
      const follow = logSource.follow;
      expect(follow).toBeDefined();

      follow?.rows([row(2), row(3)]);
      AgentSession.ingest({ agentSessionId: SESSION, entries: [row(4)] });
      await settle();

      expect(inputs()).toEqual([
        { kind: 'snapshot', rows: [row(1)] },
        { kind: 'confirmed', row: row(2) },
        { kind: 'confirmed', row: row(3) },
      ]);
      live.release();
    });

    it('holds rows delivered before the fetched log behind it', async () => {
      const log = deferred<LogSnapshot>();
      logSource.fetched.mockReturnValue(log.promise);
      const live = AgentSession.acquire(SESSION);
      // The subscription is open before the query goes out.
      expect(logSource.watch).toHaveBeenCalledWith(
        SESSION,
        'cache-and-network',
        expect.objectContaining({ rows: expect.any(Function) })
      );
      logSource.follow?.rows([row(2)]);
      log.resolve(logOf([row(1)]));
      await live.load();

      expect(inputs()).toEqual([
        { kind: 'snapshot', rows: [row(1)] },
        { kind: 'confirmed', row: row(2) },
      ]);
      live.release();
    });

    it('refetches the log on a gap in the subscription', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();
      logSource.fetched.mockResolvedValue(logOf([row(1), row(2)]));

      logSource.follow?.gap();
      await settle();

      expect(inputs().at(-1)).toEqual({
        kind: 'snapshot',
        rows: [row(1), row(2)],
      });
      live.release();
    });

    it('refetches the log when the Soup websocket reconnects', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();
      logSource.fetched.mockResolvedValue(logOf([row(1), row(2)]));

      for (const listener of soupSocket.listeners) listener();
      await settle();

      expect(inputs().at(-1)).toEqual({
        kind: 'snapshot',
        rows: [row(1), row(2)],
      });
      live.release();
      expect(soupSocket.listeners.size).toBe(0);
    });

    it('opens a fresh watch, and stops the old one, when a failed load re-runs', async () => {
      logSource.fetched.mockRejectedValueOnce(
        new logSource.Unavailable(SESSION, 'failed')
      );
      const live = AgentSession.acquire(SESSION);
      await expect(live.load()).rejects.toThrow('log could not be fetched');
      expect(logSource.watch).toHaveBeenCalledTimes(1);

      await live.load();
      expect(logSource.stop).toHaveBeenCalledTimes(1);
      expect(logSource.watch).toHaveBeenCalledTimes(2);
      live.release();
    });
  });

  it('re-runs a failed load on the next call only', async () => {
    logSource.fetched.mockRejectedValueOnce(
      new logSource.Unavailable(SESSION, 'failed')
    );
    const live = AgentSession.acquire(SESSION);
    await expect(live.load()).rejects.toThrow('log could not be fetched');

    const record = await live.load();
    expect(record.bot).toEqual(bot);
    expect(logSource.watch).toHaveBeenCalledTimes(2);
    await live.load();
    expect(logSource.watch).toHaveBeenCalledTimes(2);
    live.release();
  });

  describe('load telemetry', () => {
    const nextPaint = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );

    it('says why the cache missed', async () => {
      logSource.cacheMiss.mockReturnValue('network_first');
      const live = AgentSession.acquire(SESSION);
      await live.load();

      expect(loadSpans()[0].attributes).toMatchObject({
        'agent.session.load.cache_hit': false,
        'agent.session.load.cache_miss': 'network_first',
      });
      live.release();
    });

    it('says why a load failed', async () => {
      harness.get.mockResolvedValueOnce(err([{ code: 'HTTP_ERROR' }]));
      const live = AgentSession.acquire(SESSION);
      await expect(live.load()).rejects.toThrow();

      logSource.fetched.mockRejectedValueOnce(
        new logSource.Unavailable(SESSION, 'failed')
      );
      await expect(live.load()).rejects.toThrow();

      harness.get.mockResolvedValueOnce(err([{ code: 'UNAUTHORIZED' }]));
      await expect(live.load()).rejects.toThrow();

      fold.readSession.mockRejectedValueOnce(new Error('worker died'));
      await expect(live.load()).rejects.toThrow('worker died');

      expect(
        loadSpans().map((span) => [
          span.attributes['agent.session.load.outcome'],
          span.attributes['agent.session.load.failure'],
        ])
      ).toEqual([
        ['failed', 'session_fetch'],
        ['failed', 'log_fetch'],
        ['failed', 'access_denied'],
        ['failed', 'fold'],
      ]);
      live.release();
    });

    it('holds the render span open until the transcript has painted', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();

      live.rendered('fetched', [
        {
          agentSessionId: SESSION,
          turn: 0,
          author: { kind: 'user', userId: null },
          requestId: null,
          parts: [{ kind: 'text', text: 'Hi' }],
          stop: null,
          pending: false,
        },
        {
          agentSessionId: SESSION,
          turn: 0,
          author: { kind: 'agent' },
          requestId: null,
          parts: [
            { kind: 'thought', text: 'hmm' },
            { kind: 'text', text: 'Hello' },
          ],
          stop: null,
          pending: false,
        },
      ]);
      const [span] = renderSpans();
      expect(span.ends).toBe(0);
      expect(span.attributes).toMatchObject({
        'agent.session.render.kind': 'fetched',
        'agent.session.load.transcript_messages': 2,
        'agent.session.load.transcript_turns': 1,
        'agent.session.load.transcript_chars': 10,
      });

      await nextPaint();

      expect(span.ends).toBe(1);
      expect(
        span.attributes['agent.session.load.painted_at_ms']
      ).toBeGreaterThanOrEqual(
        span.attributes['agent.session.render.since_load_ms'] as number
      );
      expect(span.attributes['agent.session.load.paint_ms']).toEqual(
        expect.any(Number)
      );
      live.release();
    });

    it('attributes the long animation frames before the paint', async () => {
      const observed: { deliver?: (entries: unknown[]) => void } = {};
      class FakeObserver {
        static supportedEntryTypes = ['long-animation-frame'];
        constructor(callback: (list: { getEntries: () => unknown[] }) => void) {
          observed.deliver = (entries) =>
            callback({ getEntries: () => entries });
        }
        observe() {}
        takeRecords() {
          return [];
        }
        disconnect() {}
      }
      vi.stubGlobal('PerformanceObserver', FakeObserver);
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const live = AgentSession.acquire(SESSION);
      await live.load();
      const now = performance.now();
      const frame = (duration: number, scripts: unknown[]) => ({
        entryType: 'long-animation-frame',
        startTime: now - duration,
        duration,
        blockingDuration: duration - 50,
        scripts,
      });
      observed.deliver?.([
        frame(80, []),
        frame(500, [
          { duration: 100, invoker: 'small', sourceURL: 'a.js' },
          {
            duration: 300,
            invoker: 'ThreadList.positionInitial',
            sourceURL: `https://app/${'x'.repeat(300)}.js`,
          },
        ]),
      ]);

      live.rendered('fetched', []);
      await nextPaint();
      const [span] = renderSpans();
      // Ended once the frames before the paint have been reported.
      expect(span.ends).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(span.ends).toBe(1);
      expect(span.attributes).toMatchObject({
        'agent.session.load.loaf_count': 2,
        'agent.session.load.loaf_total_ms': 580,
        'agent.session.load.loaf_max_ms': 500,
        'agent.session.load.loaf_blocking_ms': 480,
        'agent.session.load.loaf_top_script_invoker':
          'ThreadList.positionInitial',
        'agent.session.load.loaf_top_script_ms': 300,
      });
      expect(
        span.attributes['agent.session.load.loaf_top_script_source']
      ).toHaveLength(200);
      live.release();
    });
  });

  describe('prompt telemetry', () => {
    it('posts a prompt inside its span and ends it at the first painted agent text', async () => {
      let postedUnder: RecordedSpan | undefined;
      harness.control.mockImplementation(
        async (_id: string, request: { actionId: string }) => {
          postedUnder = telemetry.active;
          return ok({ actionId: request.actionId, status: 'sent' });
        }
      );
      const live = AgentSession.acquire(SESSION);
      await live.load();

      await live.issue(
        { type: 'prompt', prompt: 'hi' },
        { userId: 'macro|wolf@macro.com' }
      );
      await settle();
      const actionId = (
        harness.control.mock.calls[0][1] as { actionId: string }
      ).actionId;
      expect(promptSpans()).toHaveLength(1);
      const [span] = promptSpans();
      expect(postedUnder).toBe(span);
      expect(span.ends).toBe(0);

      fold.pushSession.mockResolvedValueOnce([
        {
          kind: 'update',
          message: {
            agentSessionId: SESSION,
            turn: 1,
            author: { kind: 'user', userId: 'macro|wolf@macro.com' },
            requestId: actionId,
            parts: [{ kind: 'text', text: 'hi' }],
            stop: null,
            pending: false,
          },
        },
        {
          kind: 'new',
          message: {
            agentSessionId: SESSION,
            turn: 1,
            author: { kind: 'agent' },
            requestId: null,
            parts: [{ kind: 'thought', text: 'thinking' }],
            stop: null,
            pending: false,
          },
        },
      ] satisfies FoldedStreamEvent[]);
      AgentSession.ingest({ agentSessionId: SESSION, entries: [row(2)] });
      await settle();
      expect(span.ends).toBe(0);
      expect(span.attributes['agent.prompt.first_output_part']).toBe('thought');

      const answer = document.createElement('div');
      answer.textContent = 'Hello';
      document.body.append(answer);
      vi.spyOn(answer, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(10, 10, 300, 30)
      );
      const createRange = document.createRange.bind(document);
      const ranges = vi
        .spyOn(document, 'createRange')
        .mockImplementation(() => {
          const range = createRange();
          range.getClientRects = () => {
            const rects = [
              range.startContainer.parentElement!.getBoundingClientRect(),
            ];
            return Object.assign(rects, {
              item: (index: number) => rects[index],
            });
          };
          return range;
        });
      onTestFinished(() => ranges.mockRestore());
      const unsubscribe = live.subscribe(() => {
        // Folding establishes telemetry before that batch mounts the answer UI.
        expect(span.attributes['agent.prompt.first_text_at_ms']).toEqual(
          expect.any(Number)
        );
        live.observeRenderedText(1, answer);
      });
      fold.pushSession.mockResolvedValueOnce([
        {
          kind: 'update',
          message: {
            agentSessionId: SESSION,
            turn: 1,
            author: { kind: 'agent' },
            requestId: null,
            parts: [
              { kind: 'thought', text: 'thinking' },
              { kind: 'text', text: 'Hello' },
            ],
            stop: null,
            pending: false,
          },
        },
      ] satisfies FoldedStreamEvent[]);
      AgentSession.ingest({ agentSessionId: SESSION, entries: [row(3)] });
      await settle();
      expect(span.ends).toBe(0);
      expect(span.attributes['agent.prompt.first_text_rendered_at_ms']).toEqual(
        expect.any(Number)
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );

      expect(span.ends).toBe(1);
      expect(span.attributes).toMatchObject({
        'agent.session.id': SESSION,
        'agent.prompt.new_session': false,
        'agent.prompt.action_id': actionId,
        'agent.prompt.turn': 1,
        'agent.prompt.first_output_part': 'thought',
        'agent.prompt.first_text_via': 'socket',
        'agent.prompt.outcome': 'text',
      });
      expect(span.attributes['agent.prompt.first_text_paint_at_ms']).toEqual(
        expect.any(Number)
      );
      live.release();
      unsubscribe();
      answer.remove();
      expect(span.ends).toBe(1);
      expect(span.attributes['agent.prompt.outcome']).toBe('text');
    });

    it('traces no action but a prompt', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();

      await live.issue({ type: 'stop' });
      await live.issue({ type: 'setModel', model: 'a-model' });

      expect(promptSpans()).toEqual([]);
      live.release();
    });

    it('ends a prompt still waiting for output as released', async () => {
      const live = AgentSession.acquire(SESSION);
      await live.load();
      await live.issue({ type: 'prompt', prompt: 'hi' });

      live.release();

      const [span] = promptSpans();
      expect(span.ends).toBe(1);
      expect(span.attributes['agent.prompt.outcome']).toBe('released');
    });
  });
});
