/** @vitest-environment jsdom */

import type { AgentSessionQueueEvent } from '@queries/agent-session/realtime-protocol';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type { QueuedActionDto } from '@service-agent-harness/generated/schemas';
import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  queue: vi.fn(),
  editQueued: vi.fn(),
  removeQueued: vi.fn(),
}));
const sync = vi.hoisted(() => ({
  queueListeners: new Set<(event: AgentSessionQueueEvent) => void>(),
  socketListeners: new Set<() => void>(),
  subscribeAgentSessionQueue: vi.fn(
    (listener: (event: AgentSessionQueueEvent) => void) => {
      sync.queueListeners.add(listener);
      return () => sync.queueListeners.delete(listener);
    }
  ),
  subscribeSocketSessionStarted: vi.fn((listener: () => void) => {
    sync.socketListeners.add(listener);
    return () => sync.socketListeners.delete(listener);
  }),
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@queries/agent-session/queue-sync', () => ({
  subscribeAgentSessionQueue: sync.subscribeAgentSessionQueue,
  subscribeSocketSessionStarted: sync.subscribeSocketSessionStarted,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

const { createQueueController, resetQueueSnapshots } = await import(
  './create-queue-controller'
);

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

function entry(actionId: string, prompt: string): QueuedActionDto {
  return {
    actionId,
    kind: 'prompt',
    prompt,
    createdAt: '2026-09-24T00:00:00.000Z',
  };
}

const queuedA = [entry('a-1', 'follow up on A')];
const queuedB = [entry('b-1', 'follow up on B')];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type QueueResult = ReturnType<typeof ok<{ entries: QueuedActionDto[] }>>;

function deferred() {
  let resolve!: (value: QueueResult) => void;
  const promise = new Promise<QueueResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(session = SESSION_A) {
  const [sessionId, setSessionId] = createSignal<string | undefined>(session);
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  const { controller, dispose } = createRoot((dispose) => ({
    controller: createQueueController({ sessionId, messages }),
    dispose,
  }));
  return { controller, dispose, setSessionId, setMessages };
}

beforeEach(() => {
  vi.clearAllMocks();
  sync.queueListeners.clear();
  sync.socketListeners.clear();
  resetQueueSnapshots();
  harness.queue.mockResolvedValue(ok({ entries: [] }));
});

afterEach(() => {
  resetQueueSnapshots();
});

describe('createQueueController session switching', () => {
  it('does not show the previous session queue after a switch', async () => {
    harness.queue.mockImplementation(async (id: string) =>
      ok({ entries: id === SESSION_A ? queuedA : [] })
    );
    const { controller, dispose, setSessionId } = setup();
    await settle();
    expect(controller.entries()).toEqual(queuedA);

    setSessionId(SESSION_B);
    expect(controller.entries()).toEqual([]);
    await settle();
    expect(controller.entries()).toEqual([]);
    dispose();
  });

  it('restores a remembered queue immediately when switching back', async () => {
    const first = deferred();
    harness.queue.mockReturnValueOnce(first.promise);
    const { controller, dispose, setSessionId } = setup();
    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_A, entries: queuedA })
    );
    expect(controller.entries()).toEqual(queuedA);

    setSessionId(SESSION_B);
    expect(controller.entries()).toEqual([]);

    const second = deferred();
    harness.queue.mockReturnValueOnce(second.promise);
    setSessionId(SESSION_A);
    expect(controller.entries()).toEqual(queuedA);

    first.resolve(ok({ entries: queuedA }));
    second.resolve(ok({ entries: [] }));
    await settle();
    expect(controller.entries()).toEqual(queuedA);
    dispose();
  });

  it('restores a remembered queue when a new controller remounts the session', async () => {
    const first = setup();
    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_A, entries: queuedA })
    );
    expect(first.controller.entries()).toEqual(queuedA);
    first.dispose();

    const hung = deferred();
    harness.queue.mockReturnValueOnce(hung.promise);
    const remounted = setup();
    expect(remounted.controller.entries()).toEqual(queuedA);

    hung.resolve(ok({ entries: [] }));
    await settle();
    expect(remounted.controller.entries()).toEqual(queuedA);
    remounted.dispose();
  });

  it('lets a socket drain replace the remembered queue', async () => {
    const { controller, dispose } = setup();
    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_A, entries: queuedA })
    );
    expect(controller.entries()).toEqual(queuedA);

    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_A, entries: [] })
    );
    expect(controller.entries()).toEqual([]);
    dispose();
  });

  it('lets an empty GET win after the socket reconnects', async () => {
    const { controller, dispose } = setup();
    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_A, entries: queuedA })
    );
    expect(controller.entries()).toEqual(queuedA);

    harness.queue.mockResolvedValueOnce(ok({ entries: [] }));
    sync.socketListeners.forEach((listener) => listener());
    await settle();
    expect(controller.entries()).toEqual([]);
    dispose();
  });

  it('hides a remembered entry the fold already shows as dispatched', async () => {
    const { controller, dispose, setMessages } = setup();
    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_A, entries: queuedA })
    );
    setMessages([
      {
        agentSessionId: SESSION_A,
        turn: 1,
        author: { kind: 'user', userId: 'me' },
        requestId: 'a-1',
        parts: [{ kind: 'text', text: 'follow up on A' }],
        stop: null,
        pending: true,
      },
    ]);
    expect(controller.entries()).toEqual([]);
    dispose();
  });

  it('ignores queue events for a different session', async () => {
    harness.queue.mockResolvedValue(ok({ entries: queuedA }));
    const { controller, dispose } = setup();
    await settle();
    sync.queueListeners.forEach((listener) =>
      listener({ agentSessionId: SESSION_B, entries: queuedB })
    );
    expect(controller.entries()).toEqual(queuedA);
    dispose();
  });
});
