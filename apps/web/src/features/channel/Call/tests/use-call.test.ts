import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallLifecycleState } from '../call-lifecycle';
import { useCall } from '../use-call';

let state: CallLifecycleState;
let error: string | null;

vi.mock('../CallContext', () => ({
  useCallContext: () => ({
    callLifecycle: { getState: () => state },
    isInCall: () => state.t === 'active',
    activeChannelId: () => (state.t === 'active' ? state.call.channelId : null),
    joinError: () => error,
  }),
}));

describe('call view errors', () => {
  beforeEach(() => {
    state = { t: 'active', call: { channelId: 'channel-1', callId: 'call-1' } };
    error = null;
  });

  it('keeps the active call overlay visible when another channel cannot join', () => {
    const active = useCall(() => 'channel-1');
    const other = useCall(() => 'channel-2');
    error =
      "You're already in another call. Leave your current call before joining a new one.";
    expect(active.isInThisChannel()).toBe(true);
    expect(active.joinError()).toBeNull();
    expect(other.isInThisChannel()).toBe(false);
    expect(other.joinError()).toBe(error);
  });

  it('still exposes a failed join error when there is no live session', () => {
    const call = useCall(() => 'channel-1');
    state = {
      t: 'failed',
      channelId: 'channel-1',
      error: new Error('offline'),
    };
    error = 'Unable to join the call. Please check your connection.';
    expect(call.joinError()).toBe(error);
  });
});
