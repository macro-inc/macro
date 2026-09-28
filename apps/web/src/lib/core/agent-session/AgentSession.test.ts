/**
 * The class against a mocked worker client and harness client: inputs reach
 * the machine in order with the snapshot first, an issued action is
 * speculated before its POST and settled by the answer, and the last release
 * closes the machine.
 */

import type { FoldInput } from '@core/agent-fold/client';
import type { FoldedStreamEvent } from '@service-agent-fold/generated/types';
import type {
  AgentSessionLogEntryDto,
  AgentSessionLogResponse,
} from '@service-agent-harness/generated/schemas';
import { err, ok, type Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fold = vi.hoisted(() => ({
  pushSession: vi.fn(),
  readSession: vi.fn(),
  closeSession: vi.fn(),
}));
const harness = vi.hoisted(() => ({
  get: vi.fn(),
  getLog: vi.fn(),
  control: vi.fn(),
}));
const socket = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  subscribeSocketSessionStarted: vi.fn((listener: () => void) => {
    socket.listeners.add(listener);
    return () => socket.listeners.delete(listener);
  }),
}));

vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeSocketSessionStarted: socket.subscribeSocketSessionStarted,
}));

import {
  AgentSession,
  AgentSessionAccessDenied,
  AgentSessionReleased,
} from './AgentSession';
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
type LogResult = Result<AgentSessionLogResponse, unknown>;
const logOf = (entries: AgentSessionLogEntryDto[]): LogResult =>
  ok({ bot, entries } as unknown as AgentSessionLogResponse);

/** Every input the worker saw, flattened across pushes. */
const inputs = (): FoldInput[] =>
  fold.pushSession.mock.calls.flatMap((call) => call[1] as FoldInput[]);

/** Let awaited promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A deferred the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionTurns();
  socket.listeners.clear();
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
  harness.getLog.mockResolvedValue(ok({ bot, entries: [row(1)] }));
  harness.control.mockImplementation(
    async (_id: string, request: { actionId: string }) =>
      ok({ actionId: request.actionId, status: 'sent' })
  );
});

describe('AgentSession', () => {
  it('folds the snapshot first, then rows that arrived during the load', async () => {
    const log = deferred<LogResult>();
    harness.getLog.mockReturnValue(log.promise);

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
    const log = deferred<LogResult>();
    harness.getLog.mockReturnValue(log.promise);

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
    const log = deferred<LogResult>();
    harness.getLog.mockReturnValue(log.promise);
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
    expect(harness.getLog).toHaveBeenCalledOnce();

    first.release();
    expect(fold.closeSession).not.toHaveBeenCalled();
    expect(AgentSession.get(SESSION)).toBe(first);
    second.release();
    expect(fold.closeSession).toHaveBeenCalledWith(SESSION);
    expect(AgentSession.get(SESSION)).toBeUndefined();
  });

  it('re-snapshots when the socket reopens', async () => {
    const live = AgentSession.acquire(SESSION);
    await live.load();
    harness.getLog.mockResolvedValue(ok({ bot, entries: [row(1), row(2)] }));

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

    harness.getLog.mockResolvedValueOnce(err([{ code: 'FORBIDDEN' }]));
    await expect(live.load()).rejects.toBeInstanceOf(AgentSessionAccessDenied);
    live.release();
  });

  it('re-runs a failed load on the next call only', async () => {
    harness.getLog.mockResolvedValueOnce(err([{ code: 'NOT_FOUND' }]));
    const live = AgentSession.acquire(SESSION);
    await expect(live.load()).rejects.toThrow('log could not be fetched');

    const record = await live.load();
    expect(record.bot).toEqual(bot);
    expect(harness.getLog).toHaveBeenCalledTimes(2);
    await live.load();
    expect(harness.getLog).toHaveBeenCalledTimes(2);
    live.release();
  });
});
