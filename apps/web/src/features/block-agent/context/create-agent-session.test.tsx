/**
 * @vitest-environment jsdom
 *
 * The Solid face of a session whose load fails: the surface must be able to
 * read `session()` and show its error state instead of leaving the enclosing
 * `<Suspense>` on its fallback forever.
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
} from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { batch, createSignal, Show, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionHandle } from './create-agent-session';

const readiness = vi.hoisted(() => ({ painted: vi.fn(), cancelled: vi.fn() }));
vi.mock('@app/observability/ui-operation', async (importOriginal) => {
  const { NOOP_SPAN } = await import('@macro-inc/observability');
  return {
    ...(await importOriginal<
      typeof import('@app/observability/ui-operation')
    >()),
    startUiOperation: () => ({
      span: NOOP_SPAN,
      afterPaint: readiness.painted,
      cancel: readiness.cancelled,
    }),
  };
});

const fold = vi.hoisted(() => ({
  pushSession: vi.fn(),
  readSession: vi.fn(),
  closeSession: vi.fn(),
}));
const harness = vi.hoisted(() => ({
  get: vi.fn(),
  control: vi.fn(),
}));
const logSource = vi.hoisted(() => ({
  cached: vi.fn(),
  fetched: vi.fn(),
}));

vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeSocketSessionStarted: () => () => {},
}));
vi.mock('@queries/agent-session/log', () => ({
  AgentSessionLogUnavailable: class extends Error {},
  watchAgentSessionLog: () => ({
    cached: logSource.cached(),
    cacheMiss: () => undefined,
    fetched: logSource.fetched(),
    stop: () => {},
  }),
  canFollowAgentSessionLog: () => false,
  forgetAgentSessionLog: vi.fn(async () => undefined),
}));
vi.mock('@queries/agent-session/session-metadata-sync', () => ({
  subscribeAgentSessionRenamed: () => () => {},
  subscribeAgentSessionUpdated: () => () => {},
}));

const { cleanup, render, screen } = await import('@solidjs/testing-library');
const { AgentSession } = await import('@core/agent-session/AgentSession');
const { createAgentSession } = await import('./create-agent-session');
const { TraceFlow } = await import('@app/observability/flow');

const SESSION = '01a0ced3-b839-75ee-bc9b-7b0a11ce0789';
const bot = { id: 'bot-id', name: 'Agent', handle: 'agent' };
const session = { id: SESSION, name: 'A session', canEdit: true };

/** Reads the session row the way a pane's title does — outside any error gate. */
function Pane() {
  const live = createAgentSession(() => SESSION, {
    userId: () => 'me',
    provisioning: () => false,
  });
  return (
    <>
      <h1>{live.session()?.name ?? 'untitled'}</h1>
      <Show when={live.loadFailed()}>
        <p>{live.accessDenied() ? 'no access' : 'load failed'}</p>
      </Show>
    </>
  );
}

const mount = () =>
  render(() => (
    <Suspense fallback={<p>loading</p>}>
      <Pane />
    </Suspense>
  ));

beforeEach(() => {
  vi.clearAllMocks();
  for (
    let leaked = AgentSession.get(SESSION);
    leaked;
    leaked = AgentSession.get(SESSION)
  ) {
    leaked.release();
  }
  fold.pushSession.mockResolvedValue([]);
  fold.readSession.mockResolvedValue({
    messages: [],
    metadata: { turn: 'idle' },
  });
  harness.get.mockResolvedValue(ok(session));
  logSource.cached.mockResolvedValue(undefined);
  logSource.fetched.mockResolvedValue({ bot, rows: [] });
});
afterEach(cleanup);

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createAgentSession', () => {
  it('shows the fallback while loading and the session once loaded', async () => {
    mount();
    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText('A session')).toBeTruthy();
  });

  it('leaves the fallback and reports a failed load', async () => {
    logSource.fetched.mockRejectedValue(new Error('server error'));
    mount();
    expect(await screen.findByText('load failed')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
    expect(screen.getByText('untitled')).toBeTruthy();
  });

  it('shows the session from the cached log before the fetch answers', async () => {
    logSource.cached.mockResolvedValue({ bot, rows: [] });
    const log = deferred<{ bot: typeof bot; rows: never[] }>();
    logSource.fetched.mockReturnValue(log.promise);

    mount();
    expect(await screen.findByText('A session')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
    expect(log.promise).toBeDefined();

    log.resolve({ bot, rows: [] });
    expect(await screen.findByText('A session')).toBeTruthy();
  });

  it('reports a fetch that fails after the cached session is on screen', async () => {
    logSource.cached.mockResolvedValue({ bot, rows: [] });
    logSource.fetched.mockRejectedValue(new Error('server error'));

    mount();
    expect(await screen.findByText('load failed')).toBeTruthy();
    expect(screen.getByText('untitled')).toBeTruthy();
  });

  it('tells a 401 on the session apart from a generic failure', async () => {
    harness.get.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
    mount();
    expect(await screen.findByText('no access')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });
});

it('keeps view readiness pending through provisioning and the first transcript load', async () => {
  const [id, setId] = createSignal<string>();
  const [pending, setPending] = createSignal(true);
  const log = deferred<{ bot: typeof bot; rows: never[] }>();
  logSource.fetched.mockReturnValue(log.promise);
  function ProvisionedPane() {
    const live = createAgentSession(id, {
      userId: () => 'me',
      provisioning: pending,
    });
    return <h1>{live.session()?.name ?? 'Provisioning'}</h1>;
  }
  render(() => (
    <TraceFlow name="view.agent">
      <ProvisionedPane />
    </TraceFlow>
  ));
  await Promise.resolve();
  expect(readiness.painted).not.toHaveBeenCalled();
  batch(() => {
    setId(SESSION);
    setPending(false);
  });
  await Promise.resolve();
  expect(readiness.painted).not.toHaveBeenCalled();
  log.resolve({ bot, rows: [] });
  await screen.findByText('A session');
  expect(readiness.painted).toHaveBeenCalledOnce();
});

it('settles view readiness when provisioning fails without a session id', async () => {
  const [pending, setPending] = createSignal(true);
  function FailedPane() {
    createAgentSession(() => undefined, {
      userId: () => 'me',
      provisioning: pending,
    });
    return null;
  }
  render(() => (
    <TraceFlow name="view.agent">
      <FailedPane />
    </TraceFlow>
  ));
  await Promise.resolve();
  expect(readiness.painted).not.toHaveBeenCalled();
  setPending(false);
  await Promise.resolve();
  expect(readiness.painted).toHaveBeenCalledOnce();
});

describe('the transcript store', () => {
  const settledReply: FoldedMessage = {
    agentSessionId: SESSION,
    key: '0:agent',
    turn: 0,
    author: { kind: 'agent' },
    requestId: null,
    parts: [{ kind: 'text', text: 'settled' }],
    stop: { kind: 'end_turn' },
    pending: false,
    segments: [],
    phase: null,
    postedAt: null,
  };
  const prompt: FoldedMessage = {
    agentSessionId: SESSION,
    key: '1:user',
    turn: 1,
    author: { kind: 'user', userId: 'me' },
    requestId: null,
    parts: [{ kind: 'text', text: 'and then?' }],
    stop: null,
    pending: false,
    segments: [],
    phase: null,
    postedAt: null,
  };
  const reply: FoldedMessage = {
    agentSessionId: SESSION,
    key: '1:agent',
    turn: 1,
    author: { kind: 'agent' },
    requestId: null,
    parts: [{ kind: 'text', text: 'working' }],
    stop: null,
    pending: false,
    segments: [],
    phase: null,
    postedAt: null,
  };

  /** Mounts a session that loads `initial`, and publishes fold events to it. */
  async function mountTranscript(initial: FoldedMessage[]) {
    fold.readSession.mockResolvedValue({
      messages: initial,
      metadata: { turn: 'idle' },
    });
    let handle: AgentSessionHandle | undefined;
    function TranscriptState() {
      handle = createAgentSession(() => SESSION, {
        userId: () => 'me',
        provisioning: () => false,
      });
      return <h1>{handle.session()?.name}</h1>;
    }
    render(() => (
      <Suspense fallback={null}>
        <TranscriptState />
      </Suspense>
    ));
    await screen.findByText('A session');
    const shared = AgentSession.get(SESSION);
    if (!handle || !shared) throw new Error('session was not mounted');
    const row: AgentSessionLogEntryDto = {
      id: 'row',
      direction: 'to_server',
      createdAt: '2026-01-01T00:00:00Z',
      content: { type: 'event', event: 'acp_ready' },
    };
    const publish = async (events: FoldedStreamEvent[]) => {
      fold.pushSession.mockResolvedValueOnce(events);
      AgentSession.ingest({ agentSessionId: SESSION, entries: [row] });
      await shared.snapshot();
    };
    return { messages: handle.messages, publish };
  }

  it('appends without reading settled rows', async () => {
    let traversals = 0;
    const watched = new Proxy<FoldedMessage>(settledReply, {
      ownKeys(target) {
        traversals++;
        return Reflect.ownKeys(target);
      },
    });
    const { messages, publish } = await mountTranscript([watched]);
    const settled = messages()[0];
    traversals = 0;

    await publish([{ kind: 'new', message: prompt }]);
    await publish([{ kind: 'new', message: reply }]);

    expect(traversals).toBe(0);
    expect(messages().map((message) => message.key)).toEqual([
      '0:agent',
      '1:user',
      '1:agent',
    ]);
    expect(messages()[0]).toBe(settled);
  });

  it('keeps a streaming row the same object as it updates', async () => {
    const { messages, publish } = await mountTranscript([
      settledReply,
      prompt,
      reply,
    ]);
    const streaming = messages()[2];

    await publish([
      {
        kind: 'update',
        message: {
          ...reply,
          parts: [{ kind: 'text', text: 'working on it' }],
        },
      },
    ]);
    await publish([
      {
        kind: 'update',
        message: {
          ...reply,
          parts: [{ kind: 'text', text: 'done' }],
          stop: { kind: 'end_turn' },
        },
      },
    ]);

    expect(messages()[2]).toBe(streaming);
    expect(messages()[2]?.parts).toEqual([{ kind: 'text', text: 'done' }]);
    expect(messages()[2]?.stop).toEqual({ kind: 'end_turn' });
  });

  it('drops a speculated row on rebase and keeps rows the rebase retains', async () => {
    const { messages, publish } = await mountTranscript([settledReply]);
    const settled = messages()[0];
    const speculated: FoldedMessage = { ...prompt, pending: true };
    await publish([{ kind: 'new', message: speculated }]);
    const speculatedRow = messages()[1];

    // The log has not confirmed the prompt yet: a rebase without it.
    await publish([{ kind: 'replace', messages: [settledReply] }]);
    expect(messages().map((message) => message.key)).toEqual(['0:agent']);
    expect(messages()[0]).toBe(settled);

    // Confirmed: the prompt is back, no longer pending, ahead of its reply.
    await publish([
      { kind: 'replace', messages: [settledReply, prompt, reply] },
    ]);
    expect(messages().map((message) => message.key)).toEqual([
      '0:agent',
      '1:user',
      '1:agent',
    ]);
    expect(messages()[0]).toBe(settled);
    expect(messages()[1]).not.toBe(speculatedRow);
    expect(messages()[1]?.pending).toBe(false);
  });

  it('keeps a confirmed speculation in place across a rebase', async () => {
    const { messages, publish } = await mountTranscript([settledReply]);
    await publish([{ kind: 'new', message: { ...prompt, pending: true } }]);
    const speculatedRow = messages()[1];

    await publish([{ kind: 'replace', messages: [settledReply, prompt] }]);

    expect(messages()[1]).toBe(speculatedRow);
    expect(messages()[1]?.pending).toBe(false);
  });

  it('inserts a message that arrives out of order between its neighbours', async () => {
    const { messages, publish } = await mountTranscript([settledReply]);
    const settled = messages()[0];
    await publish([{ kind: 'new', message: reply }]);
    const replyRow = messages()[1];

    await publish([{ kind: 'new', message: prompt }]);

    expect(messages().map((message) => message.key)).toEqual([
      '0:agent',
      '1:user',
      '1:agent',
    ]);
    expect(messages()[0]).toBe(settled);
    expect(messages()[2]).toBe(replyRow);
  });

  it('updates a row before the tail in place', async () => {
    const { messages, publish } = await mountTranscript([
      settledReply,
      { ...prompt, pending: true },
      reply,
    ]);
    const promptRow = messages()[1];
    const replyRow = messages()[2];

    await publish([{ kind: 'update', message: prompt }]);

    expect(messages().map((message) => message.key)).toEqual([
      '0:agent',
      '1:user',
      '1:agent',
    ]);
    expect(messages()[1]).toBe(promptRow);
    expect(messages()[1]?.pending).toBe(false);
    expect(messages()[2]).toBe(replyRow);
  });
});
