/**
 * @vitest-environment jsdom
 *
 * The Solid face of a session whose load fails: the surface must be able to
 * read `session()` and show its error state instead of leaving the enclosing
 * `<Suspense>` on its fallback forever.
 */

import { err, ok, type Result } from 'neverthrow';
import { Show, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const cache = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeSocketSessionStarted: () => () => {},
}));
vi.mock('@queries/agent-session/log-cache', () => ({
  agentSessionLogCache: cache,
}));
vi.mock('@queries/agent-session/session-metadata-sync', () => ({
  subscribeAgentSessionRenamed: () => () => {},
  subscribeAgentSessionUpdated: () => () => {},
}));

const { cleanup, render, screen } = await import('@solidjs/testing-library');
const { AgentSession } = await import('@core/agent-session/AgentSession');
const { createAgentSession } = await import('./create-agent-session');

const SESSION = '01a0ced3-b839-75ee-bc9b-7b0a11ce0789';
const bot = { id: 'bot-id', name: 'Agent', handle: 'agent' };
const session = { id: SESSION, name: 'A session', canEdit: true };

/** Reads the session row the way a pane's title does — outside any error gate. */
function Pane() {
  const live = createAgentSession(() => SESSION, { userId: () => 'me' });
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
  harness.getLog.mockResolvedValue(ok({ bot, entries: [] }));
  cache.read.mockResolvedValue(undefined);
  cache.write.mockResolvedValue(undefined);
  cache.remove.mockResolvedValue(undefined);
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
    harness.getLog.mockResolvedValue(err([{ code: 'SERVER_ERROR' }]));
    mount();
    expect(await screen.findByText('load failed')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
    expect(screen.getByText('untitled')).toBeTruthy();
  });

  it('shows the cached session before the fetch answers, then the fetched one', async () => {
    cache.read.mockResolvedValue({
      session: { ...session, name: 'As last seen' },
      bot,
      rows: [],
    });
    const log = deferred<Result<unknown, unknown>>();
    harness.getLog.mockReturnValue(log.promise);

    mount();
    expect(await screen.findByText('As last seen')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();

    log.resolve(ok({ bot, entries: [] }));
    expect(await screen.findByText('A session')).toBeTruthy();
  });

  it('reports a fetch that fails after the cached session is on screen', async () => {
    cache.read.mockResolvedValue({
      session: { ...session, name: 'As last seen' },
      bot,
      rows: [],
    });
    harness.getLog.mockResolvedValue(err([{ code: 'SERVER_ERROR' }]));

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
