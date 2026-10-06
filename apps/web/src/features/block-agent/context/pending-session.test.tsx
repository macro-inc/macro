/** @vitest-environment jsdom */

import type { FoldInput } from '@core/agent-fold/client';
import type { FoldedStreamEvent } from '@service-agent-fold/generated/types';
import type {
  AgentSessionLogEntryDto,
  ControlRequest,
} from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fold = vi.hoisted(() => ({
  pushSession: vi.fn(),
  readSession: vi.fn(),
  closeSession: vi.fn(),
}));
const harness = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  control: vi.fn(),
}));

vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  refetchSoupEntity: vi.fn(async () => {}),
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeSocketSessionStarted: () => () => {},
}));
vi.mock('@queries/agent-session/log', () => ({
  AgentSessionLogUnavailable: class extends Error {},
  watchAgentSessionLog: () => ({
    cached: Promise.resolve(undefined),
    fetched: Promise.resolve({ bot: { id: 'bot' }, rows: [] }),
    stop: () => {},
  }),
  canFollowAgentSessionLog: () => false,
  forgetAgentSessionLog: vi.fn(async () => {}),
}));
vi.mock('@queries/agent-session/session-metadata-sync', () => ({
  subscribeAgentSessionRenamed: () => () => {},
  subscribeAgentSessionUpdated: () => () => {},
}));
vi.mock('@service-storage/graphql-soup', () => ({
  subscribeGraphqlSoupReconnected: () => () => {},
}));

const { cleanup, render } = await import('@solidjs/testing-library');
const { AgentSession } = await import('@core/agent-session/AgentSession');
const { PromptTrace } = await import('@core/agent-session/prompt-telemetry');
const { createAgentSession } = await import('./create-agent-session');
const { forgetPendingSession, pendingSession, startPendingSession } =
  await import('./pending-session');
const { resolveSessionId } = await import('./resolve-session-id');

const issue = vi.spyOn(AgentSession.prototype, 'issue');
const stage = vi.spyOn(PromptTrace.prototype, 'stage');

/** Use the same resolver/acquisition boundary as both destination providers. */
function Destination(props: { id: string }) {
  const resolved = resolveSessionId(() => props.id);
  const live = createAgentSession(resolved.sessionId, {
    userId: () => 'me',
    onAcquire: resolved.acquired,
  });
  return <p>{resolved.error() ?? live.session()?.name}</p>;
}

const mount = (id: string) =>
  render(() => (
    <Suspense>
      <Destination id={id} />
    </Suspense>
  ));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const created = (id: string) => ok({ session: { id, ownerId: 'me' } });
const accepted = (request: ControlRequest) =>
  ok({ actionId: request.actionId, status: 'sent' });
const settle = () => vi.advanceTimersByTimeAsync(0);
const promptTrace = () => issue.mock.calls[0]?.[1]?.trace;
const snapshots = () =>
  fold.pushSession.mock.calls
    .flatMap((call) => call[1] as FoldInput[])
    .filter((input) => input.kind === 'snapshot');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fold.pushSession.mockResolvedValue([]);
  fold.readSession.mockResolvedValue({
    messages: [],
    metadata: { turn: 'idle' },
  });
  harness.create.mockImplementation(async ({ id }: { id: string }) =>
    created(id)
  );
  harness.get.mockImplementation(async (id: string) =>
    ok({ id, name: 'New session' })
  );
  harness.control.mockImplementation(async (_id, request: ControlRequest) =>
    accepted(request)
  );
});

afterEach(() => {
  cleanup();
  for (const [request] of harness.create.mock.calls) {
    forgetPendingSession(request.id);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('pending navigation ownership', () => {
  it('keeps one fold and the prompt trace when the POST finishes before mount', async () => {
    const id = startPendingSession({ prompt: 'Hello' });
    await settle();
    const beforeMount = AgentSession.get(id);
    const trace = promptTrace();
    expect(beforeMount).toBeDefined();
    expect(trace).toBeInstanceOf(PromptTrace);
    expect(trace?.ended).toBe(false);
    expect(fold.closeSession).not.toHaveBeenCalled();

    const destination = mount(id);
    await settle();
    expect(AgentSession.get(id)).toBe(beforeMount);
    expect(pendingSession(id)).toBeUndefined();
    expect(harness.get).toHaveBeenCalledOnce();
    expect(snapshots()).toHaveLength(1);
    expect(fold.closeSession).not.toHaveBeenCalled();

    const request = harness.control.mock.calls[0][1] as ControlRequest;
    fold.pushSession.mockResolvedValueOnce([
      {
        kind: 'update',
        message: {
          agentSessionId: id,
          turn: 1,
          author: { kind: 'user', userId: 'me' },
          requestId: request.actionId ?? null,
          parts: [{ kind: 'text', text: 'Hello' }],
          stop: null,
          pending: false,
        },
      },
      {
        kind: 'new',
        message: {
          agentSessionId: id,
          turn: 1,
          author: { kind: 'agent' },
          requestId: null,
          parts: [{ kind: 'text', text: 'Ready' }],
          stop: null,
          pending: false,
        },
      },
    ] satisfies FoldedStreamEvent[]);
    AgentSession.ingest({
      agentSessionId: id,
      entries: [
        {
          id: 'confirmed-row',
          createdAt: new Date().toISOString(),
          direction: 'to_server',
          content: { type: 'acp', jsonrpc: '2.0' },
        } satisfies AgentSessionLogEntryDto,
      ],
    });
    await settle();
    const firstText = stage.mock.calls.findIndex(
      ([name]) => name === 'first_text'
    );
    expect(firstText).toBeGreaterThanOrEqual(0);
    expect(stage.mock.contexts[firstText]).toBe(trace);
    expect(fold.closeSession).not.toHaveBeenCalled();

    destination.unmount();
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('hands off before the POST answers and releases each owner once', async () => {
    const creation = deferred<ReturnType<typeof created>>();
    const delivery = deferred<ReturnType<typeof accepted>>();
    harness.create.mockReturnValue(creation.promise);
    harness.control.mockReturnValue(delivery.promise);
    const id = startPendingSession({ prompt: 'Hello' });
    const destination = mount(id);
    creation.resolve(created(id));
    await settle();
    const beforeAccepted = AgentSession.get(id);
    expect(beforeAccepted).toBeDefined();
    expect(pendingSession(id)).toBeUndefined();

    delivery.resolve(accepted(harness.control.mock.calls[0][1]));
    await settle();
    expect(AgentSession.get(id)).toBe(beforeAccepted);
    expect(promptTrace()?.ended).toBe(false);
    expect(harness.get).toHaveBeenCalledOnce();
    expect(snapshots()).toHaveLength(1);
    expect(fold.closeSession).not.toHaveBeenCalled();

    destination.unmount();
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('retains the POST owner when the destination unmounts during delivery', async () => {
    const delivery = deferred<ReturnType<typeof accepted>>();
    harness.control.mockReturnValue(delivery.promise);
    const id = startPendingSession({ prompt: 'Hello' });
    await settle();
    const destination = mount(id);
    await settle();
    destination.unmount();
    expect(AgentSession.get(id)).toBeDefined();
    expect(fold.closeSession).not.toHaveBeenCalled();

    delivery.resolve(accepted(harness.control.mock.calls[0][1]));
    await settle();
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('expires a ready session whose navigation never mounts', async () => {
    const id = startPendingSession({ prompt: 'Hello' });
    await settle();
    expect(AgentSession.get(id)).toBeDefined();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(pendingSession(id)).toBeUndefined();
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
    expect(promptTrace()?.ended).toBe(true);
  });

  it('bounds an abandoned create and does not retain a late result', async () => {
    const creation = deferred<ReturnType<typeof created>>();
    harness.create.mockReturnValue(creation.promise);
    const id = startPendingSession({ prompt: 'Hello' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(pendingSession(id)).toBeUndefined();
    creation.resolve(created(id));
    await settle();
    expect(harness.control).toHaveBeenCalledOnce();
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('still delivers a slow create to its mounted destination after registry expiry', async () => {
    const creation = deferred<ReturnType<typeof created>>();
    harness.create.mockReturnValue(creation.promise);
    const id = startPendingSession({ prompt: 'Hello' });
    const destination = mount(id);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(pendingSession(id)).toBeUndefined();
    creation.resolve(created(id));
    await settle();
    expect(AgentSession.get(id)).toBeDefined();
    expect(harness.control).toHaveBeenCalledOnce();
    expect(fold.closeSession).not.toHaveBeenCalled();
    destination.unmount();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('releases a failed prompt immediately while preserving its startup error', async () => {
    harness.control.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'Runtime is disconnected.' }])
    );
    const id = startPendingSession({ prompt: 'Hello' });
    await settle();
    expect(pendingSession(id)?.error()).toBe('Runtime is disconnected.');
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
    expect(promptTrace()?.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(pendingSession(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledOnce();
  });

  it('forgets a failed create when its error view unmounts', async () => {
    harness.create.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'Could not create session.' }])
    );
    const id = startPendingSession({ prompt: 'Hello' });
    await settle();
    const destination = mount(id);
    expect(pendingSession(id)?.error()).toBe('Could not create session.');
    destination.unmount();
    expect(pendingSession(id)).toBeUndefined();
    expect(harness.get).not.toHaveBeenCalled();
    expect(fold.closeSession).not.toHaveBeenCalled();
  });
});
