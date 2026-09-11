import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentSessionMentionStatus } from './mention-status';
import type { AgentSessionStatus } from './mention-types';
import type { AgentSessionLogEvent } from './realtime-protocol';

afterEach(() => vi.useRealTimers());

describe('mention status lifecycle', () => {
  it('keeps live events ahead of in-flight snapshots and cleans up on session changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(200);
    let sink: (event: AgentSessionLogEvent) => void = () => {};
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((_id: string, callback: typeof sink) => {
      sink = callback;
      return unsubscribe;
    });
    const state = createRoot((dispose) => {
      const [id, setId] = createSignal<string | undefined>('one');
      const [snapshot, setSnapshot] = createSignal<{
        status: AgentSessionStatus;
        updatedAt: number;
      }>({ status: { kind: 'no_messages' }, updatedAt: 100 });
      const status = createAgentSessionMentionStatus(id, snapshot, subscribe);
      return { dispose, setId, setSnapshot, status };
    });
    expect(subscribe).toHaveBeenCalledWith('one', expect.any(Function));
    sink({
      agentSessionId: 'one',
      id: 'event',
      createdAt: new Date(200).toISOString(),
      direction: 'to_server',
      content: { type: 'event', event: 'session/end' },
    });
    expect(state.status()).toEqual({ kind: 'event', event: 'session/end' });
    state.setSnapshot({ status: { kind: 'no_messages' }, updatedAt: 150 });
    expect(state.status()).toEqual({ kind: 'event', event: 'session/end' });
    state.setSnapshot({ status: { kind: 'disconnected' }, updatedAt: 300 });
    expect(state.status()).toEqual({ kind: 'disconnected' });
    state.setId('two');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenLastCalledWith('two', expect.any(Function));
    state.setId(undefined);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    state.dispose();
    vi.restoreAllMocks();
  });
});
