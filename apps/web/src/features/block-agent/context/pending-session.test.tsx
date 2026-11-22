/** @vitest-environment jsdom */

import type { FoldInput } from '@core/agent-fold/client';
import { holdMobile, MOBILE_DEVICES } from '@core/agent-session/tests/device';
import type { FoldedStreamEvent } from '@service-agent-fold/generated/types';
import type {
  AgentSessionLogEntryDto,
  ControlRequest,
} from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { type JSX, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fold = vi.hoisted(() => ({
  pushSession: vi.fn(),
  readSession: vi.fn(),
  closeSession: vi.fn(),
}));
const flags = vi.hoisted(() => ({
  firstPromptOnCreate: true,
}));
const harness = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  control: vi.fn(),
  queue: vi.fn(),
}));

const warm = vi.hoisted(() => ({
  take: vi.fn((): { id?: string; claim: string } => ({
    claim: 'miss_none_ready',
  })),
}));
vi.mock('@queries/agent-session/warm', () => ({
  takeWarmAgentSession: warm.take,
  replenishWarmAgentSession: () => {},
}));
const cachedUser = vi.hoisted(() => ({ id: undefined as string | undefined }));
vi.mock('@queries/auth/user-info', () => ({
  cachedUserId: () => cachedUser.id,
}));
vi.mock('@core/agent-fold/client', () => fold);
vi.mock('@core/constant/featureFlags', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@core/constant/featureFlags')>();
  return {
    ...actual,
    isFeatureEnabled: (flag: Parameters<typeof actual.isFeatureEnabled>[0]) => {
      if (flag === actual.enableFirstPromptOnCreate) {
        return flags.firstPromptOnCreate;
      }
      return actual.isFeatureEnabled(flag);
    },
  };
});
const device = vi.hoisted(() => ({ nativeApp: false, touch: false }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => device.nativeApp,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
// These cases count the pending navigation's own acquisitions; holding the
// session open after a view is `recently-viewed.test.ts`'s concern.
vi.mock('@core/agent-session/recently-viewed', () => ({
  isRecentlyViewed: () => false,
  retainRecentlyViewed: () => {},
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  refetchSoupEntity: vi.fn(async () => {}),
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeSocketSessionStarted: () => () => {},
}));
type LogFollow = { rows: (rows: AgentSessionLogEntryDto[]) => void };
/** Each session's latest load subscription, which delivers its live rows. */
const follows = vi.hoisted(() => new Map<string, LogFollow>());
vi.mock('@queries/agent-session/log', () => ({
  AgentSessionLogUnavailable: class extends Error {},
  watchAgentSessionLog: (id: string, _policy?: string, follow?: LogFollow) => {
    if (follow) follows.set(id, follow);
    return {
      cached: Promise.resolve(undefined),
      cacheMiss: () => undefined,
      fetched: Promise.resolve({ bot: { id: 'bot' }, rows: [] }),
      stop: () => {},
    };
  },
  forgetAgentSessionLog: vi.fn(async () => {}),
}));

/** A row the log subscription delivers to an open session. */
function deliver(id: string, row: AgentSessionLogEntryDto) {
  const follow = follows.get(id);
  if (!follow) throw new Error(`session ${id} is not followed`);
  follow.rows([row]);
}
vi.mock('@queries/agent-session/session-metadata-sync', () => ({
  subscribeAgentSessionRenamed: () => () => {},
  subscribeAgentSessionUpdated: () => () => {},
}));
vi.mock('@service-storage/graphql-soup', () => ({
  subscribeGraphqlSoupReconnected: () => () => {},
}));

const { QueryClient, QueryClientProvider } = await import(
  '@tanstack/solid-query'
);
const { cleanup, render } = await import('@solidjs/testing-library');
const { AgentSession } = await import('@core/agent-session/AgentSession');
const { PromptTrace } = await import('@core/agent-session/prompt-telemetry');
const { createAgentSession } = await import('./create-agent-session');
const { forgetPendingSession, pendingSession, startPendingSession } =
  await import('./pending-session');
const { resolveSessionId } = await import('./resolve-session-id');
const { forgetUnconfirmedSendsInMemory, unconfirmedSends } = await import(
  '@core/agent-session/unconfirmed-sends'
);

const issue = vi.spyOn(AgentSession.prototype, 'issue');
const stage = vi.spyOn(PromptTrace.prototype, 'stage');

/** Use the same resolver/acquisition boundary as both destination providers. */
function Destination(props: { id: string }) {
  const resolved = resolveSessionId(() => props.id);
  const live = createAgentSession(resolved.sessionId, {
    userId: () => 'me',
    provisioning: resolved.pending,
    onAcquire: resolved.acquired,
  });
  return <p>{resolved.error() ?? live.session()?.name}</p>;
}

const mount = (id: string) =>
  render(
    () => (
      <Suspense>
        <Destination id={id} />
      </Suspense>
    ),
    { wrapper: TestQueryClientProvider }
  );

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

const TestQueryClientProvider = (props: { children: JSX.Element }) => (
  <QueryClientProvider client={new QueryClient()}>
    {props.children}
  </QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  forgetUnconfirmedSendsInMemory();
  cachedUser.id = undefined;
  flags.firstPromptOnCreate = true;
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
  // A persona delivers its first prompt with a control POST once the session
  // exists; these cover who owns the fold while that POST is out.
  it('keeps one fold and the prompt trace when the POST finishes before mount', async () => {
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
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
          key: '1:user',
          turn: 1,
          author: { kind: 'user', userId: 'me' },
          requestId: request.actionId ?? null,
          parts: [{ kind: 'text', text: 'Hello' }],
          stop: null,
          pending: false,
          segments: [],
          phase: null,
          postedAt: null,
        },
      },
      {
        kind: 'new',
        message: {
          agentSessionId: id,
          key: '1:agent',
          turn: 1,
          author: { kind: 'agent' },
          requestId: null,
          parts: [{ kind: 'text', text: 'Ready' }],
          stop: null,
          pending: false,
          segments: [],
          phase: null,
          postedAt: null,
        },
      },
    ] satisfies FoldedStreamEvent[]);
    deliver(id, {
      id: 'confirmed-row',
      createdAt: new Date().toISOString(),
      direction: 'to_server',
      content: { type: 'acp', jsonrpc: '2.0' },
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
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
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
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
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
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
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
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
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
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
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
      err([
        {
          code: 'HTTP_ERROR',
          status: 409,
          message: 'Runtime is disconnected.',
        },
      ])
    );
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
    await settle();
    expect(pendingSession(id)?.error()).toBe('Runtime is disconnected.');
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
    expect(promptTrace()?.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(pendingSession(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledOnce();
  });

  it('never hands back a first prompt whose send could not be confirmed', async () => {
    harness.control.mockResolvedValue(
      err([
        {
          code: 'HTTP_ERROR',
          status: 504,
          message: 'Agent request failed (HTTP 504).',
        },
      ])
    );
    harness.queue.mockResolvedValue(ok({ entries: [] }));
    const onDelivered = vi.fn();
    const onFailure = vi.fn();
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
      onDelivered,
      onFailure,
    });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(onFailure).not.toHaveBeenCalled();
    expect(onDelivered).toHaveBeenCalledOnce();
    expect(pendingSession(id)?.error()).toBeUndefined();
  });

  it('asks again under the same id when a create gets no clear answer, and adopts the session it made', async () => {
    const gatewayTimeout = {
      code: 'HTTP_ERROR',
      status: 504,
      message: 'Agent request failed (HTTP 504).',
    };
    const taken = {
      code: 'SESSION_ID_TAKEN',
      status: 409,
      message: 'this id is already taken',
    };
    harness.get.mockImplementationOnce(async (sessionId: string) =>
      ok({ id: sessionId, ownerId: 'macro|me@macro.com' })
    );
    harness.create
      .mockResolvedValueOnce(err([gatewayTimeout]))
      .mockResolvedValueOnce(err([taken]));
    const onFailure = vi.fn();
    const id = startPendingSession({
      prompt: 'Hello',
      onFailure,
      userId: 'macro|me@macro.com',
    });
    await vi.advanceTimersByTimeAsync(2_000);

    const ids = harness.create.mock.calls.map(([request]) => request.id);
    expect(ids).toEqual([id, id]);
    expect(onFailure).not.toHaveBeenCalled();
    expect(pendingSession(id)?.sessionId()).toBe(id);
    // Whether the first create started the prompt is unknown: kept, not lost.
    expect(unconfirmedSends(id, 'macro|me@macro.com')).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({ type: 'prompt', prompt: 'Hello' }),
      }),
    ]);
  });

  it.each([
    ['the session it made cannot be read', 'unreadable'],
    ['a retry is refused', 'refused'],
  ])('keeps a lost first create unconfirmed when %s', async (_name, then) => {
    const gatewayTimeout = {
      code: 'HTTP_ERROR',
      status: 504,
      message: 'Agent request failed (HTTP 504).',
    };
    harness.create
      .mockResolvedValueOnce(err([gatewayTimeout]))
      .mockResolvedValueOnce(
        err([
          then === 'unreadable'
            ? {
                code: 'SESSION_ID_TAKEN',
                status: 409,
                message: 'this id is already taken',
              }
            : {
                code: 'HTTP_ERROR',
                status: 422,
                message: 'owner is not a known user',
              },
        ])
      );
    if (then === 'unreadable')
      harness.get.mockResolvedValueOnce(err([gatewayTimeout]));
    const onFailure = vi.fn();
    const id = startPendingSession({
      prompt: 'Hello',
      onFailure,
      userId: 'macro|me@macro.com',
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.create).toHaveBeenCalledTimes(2);
    // The unreadable case really reads the session it was told exists.
    expect(harness.get).toHaveBeenCalledTimes(then === 'unreadable' ? 1 : 0);
    expect(onFailure).not.toHaveBeenCalled();
    expect(pendingSession(id)?.error()).toContain('may not have been created');
    expect(unconfirmedSends(id, 'macro|me@macro.com')).toHaveLength(1);
  });

  it('holds a first prompt whose warm fallback create got no clear answer, under the fallback id', async () => {
    warm.take.mockReturnValueOnce({ id: 'expired-warm', claim: 'hit' });
    const gatewayTimeout = {
      code: 'HTTP_ERROR',
      status: 504,
      message: 'Agent request failed (HTTP 504).',
    };
    harness.create
      .mockResolvedValueOnce(
        err([
          {
            code: 'SESSION_ID_TAKEN',
            status: 409,
            message: 'this id is already taken',
          },
        ])
      )
      .mockResolvedValue(err([gatewayTimeout]));
    const onFailure = vi.fn();
    const id = startPendingSession({
      prompt: 'Hello',
      onFailure,
      userId: 'macro|me@macro.com',
    });
    await vi.advanceTimersByTimeAsync(10_000);

    const ids = harness.create.mock.calls.map(([request]) => request.id);
    expect(ids[0]).toBe('expired-warm');
    const fallback = ids[1];
    expect(fallback).not.toBe('expired-warm');
    expect(ids.slice(1)).toEqual([fallback, fallback, fallback]);
    expect(onFailure).not.toHaveBeenCalled();
    expect(pendingSession(id)?.heldId()).toBe(fallback);
    expect(unconfirmedSends(fallback, 'macro|me@macro.com')).toHaveLength(1);
  });

  it('adopts its own lost create for a caller that passes no person', async () => {
    // ChatWithAgentButton and other callers outside a component pass none.
    cachedUser.id = 'macro|me@macro.com';
    harness.create
      .mockResolvedValueOnce(
        err([
          {
            code: 'HTTP_ERROR',
            status: 504,
            message: 'Agent request failed (HTTP 504).',
          },
        ])
      )
      .mockResolvedValueOnce(
        err([
          {
            code: 'SESSION_ID_TAKEN',
            status: 409,
            message: 'this id is already taken',
          },
        ])
      );
    harness.get.mockImplementationOnce(async (sessionId: string) =>
      ok({ id: sessionId, ownerId: 'macro|me@macro.com' })
    );
    const onFailure = vi.fn();
    const id = startPendingSession({
      userId: undefined,
      prompt: 'Hello',
      onFailure,
    });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(onFailure).not.toHaveBeenCalled();
    expect(pendingSession(id)?.error()).toBeUndefined();
    expect(harness.create).toHaveBeenCalledTimes(2);
    expect(pendingSession(id)?.sessionId()).toBe(id);
    expect(unconfirmedSends(id, 'macro|me@macro.com')).toHaveLength(1);
  });

  it('never falls back to a new id, or hands the prompt back, when creates get no clear answer', async () => {
    harness.create.mockResolvedValue(
      err([
        {
          code: 'HTTP_ERROR',
          status: 504,
          message: 'Agent request failed (HTTP 504).',
        },
      ])
    );
    const onFailure = vi.fn();
    const id = startPendingSession({
      prompt: 'Hello',
      onFailure,
      userId: 'macro|me@macro.com',
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(
      new Set(harness.create.mock.calls.map(([request]) => request.id))
    ).toEqual(new Set([id]));
    expect(onFailure).not.toHaveBeenCalled();
    expect(pendingSession(id)?.error()).toContain('may not have been created');
    expect(unconfirmedSends(id, 'macro|me@macro.com')).toHaveLength(1);
  });

  it('forgets a failed create when its error view unmounts', async () => {
    harness.create.mockResolvedValue(
      err([
        {
          code: 'HTTP_ERROR',
          status: 422,
          message: 'Could not create session.',
        },
      ])
    );
    const id = startPendingSession({
      userId: undefined,
      botId: 'persona',
      prompt: 'Hello',
    });
    await settle();
    const destination = mount(id);
    expect(pendingSession(id)?.error()).toBe('Could not create session.');
    destination.unmount();
    expect(pendingSession(id)).toBeUndefined();
    expect(harness.get).not.toHaveBeenCalled();
    expect(fold.closeSession).not.toHaveBeenCalled();
  });
});

it('retains submitting context until the first prompt is accepted', async () => {
  const delivery = deferred<ReturnType<typeof accepted>>();
  harness.control.mockReturnValue(delivery.promise);
  const onDelivered = vi.fn();
  const onFailure = vi.fn();
  startPendingSession({
    userId: undefined,
    botId: 'persona',
    prompt: 'Hello',
    onDelivered,
    onFailure,
  });
  await settle();
  expect(onDelivered).not.toHaveBeenCalled();
  delivery.resolve(accepted(harness.control.mock.calls[0][1]));
  await settle();
  expect(onDelivered).toHaveBeenCalledOnce();
  expect(onFailure).not.toHaveBeenCalled();
});

it('restores submitting context when speed configuration fails', async () => {
  fold.readSession.mockResolvedValue({
    messages: [],
    metadata: {
      turn: 'idle',
      model: 'openai/gpt-6-astra',
      configOptions: [
        {
          id: 'speed',
          type: 'select',
          currentValue: 'standard',
          options: [{ value: 'standard' }],
        },
      ],
    },
  });
  const onDelivered = vi.fn();
  const onFailure = vi.fn();
  const id = startPendingSession({
    userId: undefined,
    prompt: 'Keep this draft',
    modelOverride: 'openai/gpt-6-astra',
    speedOverride: { configId: 'speed', value: 'ultrafast' },
    onDelivered,
    onFailure,
  });
  await settle();
  expect(pendingSession(id)?.failed()).toBe(true);
  expect(onDelivered).not.toHaveBeenCalled();
  expect(onFailure).toHaveBeenCalledOnce();
  expect(harness.control).not.toHaveBeenCalled();
});

describe('first prompt on the create', () => {
  it("sends the default persona's first prompt with the create and traces it from there", async () => {
    const id = startPendingSession({ prompt: 'Hello', userId: 'me' });
    await settle();

    const [request] = harness.create.mock.calls[0];
    expect(request).toEqual({
      id,
      prompt: 'Hello',
      promptActionId: expect.any(String),
      promptClientId: expect.any(String),
    });
    const actionId: string = request.promptActionId;
    expect(harness.control).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();

    const destination = mount(id);
    await settle();
    expect(
      fold.pushSession.mock.calls
        .flatMap((call) => call[1] as FoldInput[])
        .filter((input) => input.kind === 'speculated')
    ).toEqual([
      {
        kind: 'speculated',
        actionId,
        action: { type: 'prompt', prompt: 'Hello' },
        userId: 'me',
      },
    ]);
    const acceptedAt = stage.mock.calls.findIndex(
      ([name]) => name === 'accepted'
    );
    expect(acceptedAt).toBeGreaterThanOrEqual(0);
    const trace = stage.mock.contexts[acceptedAt];
    expect(trace).toBeInstanceOf(PromptTrace);

    fold.pushSession.mockResolvedValueOnce([
      {
        kind: 'update',
        message: {
          agentSessionId: id,
          key: '1:user',
          turn: 1,
          author: { kind: 'user', userId: 'me' },
          requestId: actionId,
          parts: [{ kind: 'text', text: 'Hello' }],
          stop: null,
          pending: false,
          segments: [],
          phase: null,
          postedAt: null,
        },
      },
      {
        kind: 'new',
        message: {
          agentSessionId: id,
          key: '1:agent',
          turn: 1,
          author: { kind: 'agent' },
          requestId: null,
          parts: [{ kind: 'text', text: 'Ready' }],
          stop: null,
          pending: false,
          segments: [],
          phase: null,
          postedAt: null,
        },
      },
    ] satisfies FoldedStreamEvent[]);
    deliver(id, {
      id: 'confirmed-row',
      createdAt: new Date().toISOString(),
      direction: 'to_server',
      content: { type: 'acp', jsonrpc: '2.0' },
    });
    await settle();
    const firstText = stage.mock.calls.findIndex(
      ([name]) => name === 'first_text'
    );
    expect(firstText).toBeGreaterThanOrEqual(0);
    expect(stage.mock.contexts[firstText]).toBe(trace);

    destination.unmount();
    expect(AgentSession.get(id)).toBeUndefined();
    expect(fold.closeSession).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('names the tab the first prompt was typed in', async () => {
    startPendingSession({ prompt: 'Open the plan', userId: 'me' });
    await settle();

    const [request] = harness.create.mock.calls[0];
    expect(request.promptClientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it.each(MOBILE_DEVICES)(
    'names no tab for a first prompt typed on $on',
    async (mobile) => {
      holdMobile(device, mobile);
      startPendingSession({ prompt: 'Open the plan', userId: 'me' });
      await settle();

      const [request] = harness.create.mock.calls[0];
      expect(request.prompt).toBe('Open the plan');
      expect(request).not.toHaveProperty('promptClientId');
    }
  );

  it("keeps an effort's first prompt for after the session is configured", async () => {
    const id = startPendingSession({
      userId: undefined,
      prompt: 'Hello',
      effortOverride: { configId: 'effort', value: 'high' },
    });
    await settle();

    expect(harness.create.mock.calls[0][0]).toEqual({ id });
  });

  it('sends the first prompt as a control POST while the rollout is off', async () => {
    flags.firstPromptOnCreate = false;
    const id = startPendingSession({ userId: undefined, prompt: 'Hello' });
    await settle();

    expect(harness.create.mock.calls[0][0]).toEqual({ id });
    expect(harness.control).toHaveBeenCalledOnce();
    expect(harness.control.mock.calls[0][1]).toMatchObject({
      type: 'prompt',
      prompt: 'Hello',
    });
  });

  it("keeps a speed's first prompt for after the session is configured", async () => {
    const id = startPendingSession({
      userId: undefined,
      prompt: 'Hello',
      speedOverride: { configId: 'speed', value: 'fast' },
    });
    await settle();

    expect(harness.create.mock.calls[0][0]).toEqual({ id });
  });

  it('releases submitting context once the create carrying the prompt answers', async () => {
    const onDelivered = vi.fn();
    const onFailure = vi.fn();
    startPendingSession({
      userId: undefined,
      prompt: 'Hello',
      onDelivered,
      onFailure,
    });
    await settle();
    expect(onDelivered).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    expect(harness.control).not.toHaveBeenCalled();
  });
});
