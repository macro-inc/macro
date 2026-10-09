import type {
  FoldedMessage,
  FoldedStreamEvent,
} from '@service-agent-fold/generated/types';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('@core/agent-session/AgentSession', () => ({
  AgentSession: { acquire: fake.acquire },
}));

import { createLiveSession, RELEASE_DELAY_MS } from './live-session';

function session() {
  let listener: ((events: FoldedStreamEvent[]) => void) | undefined;
  return {
    load: vi.fn(async () => ({})),
    snapshot: vi.fn(async () => ({
      messages: [],
      metadata: { pendingInteractions: [], turn: 'idle' },
    })),
    subscribe: vi.fn((callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
    release: vi.fn(),
    issue: vi.fn(),
    emit: (events: FoldedStreamEvent[]) => listener?.(events),
  };
}

function message(text: string): FoldedMessage {
  return {
    agentSessionId: 'session',
    turn: 0,
    author: { kind: 'agent' },
    requestId: null,
    parts: [{ kind: 'text', text }],
    stop: null,
    pending: false,
    segments: [],
    phase: 'writing',
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('live agent session', () => {
  it('batches token paints and releases its subscription on a context change', async () => {
    vi.useFakeTimers();
    const first = session();
    const second = session();
    fake.acquire.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const scope = createRoot((dispose) => {
      const [id, setId] = createSignal<string | undefined>('first');
      return { live: createLiveSession(id), setId, dispose };
    });
    await vi.runAllTimersAsync();
    first.emit([{ kind: 'new', message: message('a') }]);
    first.emit([{ kind: 'update', message: message('answer') }]);
    expect(scope.live.messages()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(scope.live.messages()).toEqual([message('answer')]);
    scope.setId('second');
    expect(scope.live.messages()).toEqual([]);
    first.emit([{ kind: 'update', message: message('old context') }]);
    // The fold lingers for a surface about to show it again.
    expect(first.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RELEASE_DELAY_MS);
    expect(first.release).toHaveBeenCalledOnce();
    expect(scope.live.messages()).toEqual([]);
    scope.dispose();
    await vi.runAllTimersAsync();
    expect(second.release).toHaveBeenCalledOnce();
  });

  it('does not hide a stream failure and lets the user reconnect', async () => {
    const broken = session();
    broken.load.mockRejectedValueOnce(new Error('disconnected'));
    fake.acquire.mockReturnValue(broken);
    const scope = createRoot((dispose) => ({
      live: createLiveSession(() => 'session'),
      dispose,
    }));
    await vi.waitFor(() => expect(scope.live.failed()).toBe(true));
    scope.live.retry();
    await vi.waitFor(() => expect(broken.load).toHaveBeenCalledTimes(2));
    expect(scope.live.failed()).toBe(false);
    scope.dispose();
  });

  it('treats a session the viewer cannot read as denied, not failed', async () => {
    const private_ = session();
    const denied = Object.assign(new Error('no access'), {
      name: 'AgentSessionAccessDenied',
    });
    private_.load.mockRejectedValueOnce(denied);
    fake.acquire.mockReturnValue(private_);
    const scope = createRoot((dispose) => ({
      live: createLiveSession(() => 'session'),
      dispose,
    }));
    await vi.waitFor(() => expect(scope.live.denied()).toBe(true));
    expect(scope.live.failed()).toBe(false);
    expect(scope.live.loaded()).toBe(false);
    scope.dispose();
  });

  it('keeps one subscription while the same session is read again', async () => {
    const live = session();
    fake.acquire.mockReturnValue(live);
    const scope = createRoot((dispose) => {
      // A typing heartbeat: new state, same session.
      const [typing, setTyping] = createSignal({ sessionId: 'session' });
      return {
        live: createLiveSession(() => typing().sessionId),
        heartbeat: () => setTyping({ sessionId: 'session' }),
        dispose,
      };
    });
    await vi.waitFor(() => expect(scope.live.loaded()).toBe(true));
    scope.heartbeat();
    expect(fake.acquire).toHaveBeenCalledOnce();
    expect(live.release).not.toHaveBeenCalled();
    expect(scope.live.loaded()).toBe(true);
    scope.dispose();
  });

  it('never acquires a runtime for an empty conversation', () => {
    createRoot((dispose) => {
      createLiveSession(() => undefined);
      dispose();
    });
    expect(fake.acquire).not.toHaveBeenCalled();
  });
});
