import { ThrownResultError } from '@core/util/result';
import type { CallTokenResponse } from '@service-call/client';
import type { DisconnectReason } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActiveCallLookup, AUTO_REJOIN_DELAY_MS } from '../auto-rejoin';
import {
  createCallLifecycle,
  JOIN_TIMEOUT_MS,
  LEAVE_TIMEOUT_MS,
} from '../call-lifecycle';
import { LK_DISCONNECT_REASON } from '../livekit-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const call = { channelId: 'channel-1', callId: 'call-1' };
const token: CallTokenResponse = {
  ...call,
  roomName: 'room-1',
  token: 'token',
  serverUrl: 'ws://localhost',
  participantId: 'macro|test@example.com',
  shareToken: null,
} satisfies CallTokenResponse;
const cleanups: (() => void)[] = [];

function setup() {
  let disconnected: (reason?: DisconnectReason) => void = () => {};
  let nativeEnded: () => void = () => {};
  const unwatch = vi.fn();
  const ports = {
    shouldRequestToken: vi.fn(() => true),
    requestToken: vi.fn(async () => token),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    lookup: vi.fn<() => Promise<ActiveCallLookup>>(async () => ({
      callId: call.callId,
    })),
    currentCall: vi.fn(() => call),
    beginJoin: vi.fn(),
    rollbackJoin: vi.fn(),
    setError: vi.fn(),
    watch: vi.fn((_call, onDisconnect, onNativeEnd) => {
      disconnected = onDisconnect;
      nativeEnded = onNativeEnd;
      return unwatch;
    }),
    onJoined: vi.fn(),
    onLeft: vi.fn(),
    reportError: vi.fn(),
  } satisfies Parameters<typeof createCallLifecycle>[0];
  const lifecycle = createCallLifecycle(ports);
  cleanups.push(lifecycle.dispose);
  return {
    lifecycle,
    ports,
    unwatch,
    disconnect: (reason?: DisconnectReason) => disconnected(reason),
    nativeEnd: () => nativeEnded(),
    async join() {
      const promise = lifecycle.join(call.channelId);
      await vi.advanceTimersByTimeAsync(300);
      await promise;
    },
  };
}

describe('shared call lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
  });

  it('shares one in-flight join across controls and rejects a competing channel', async () => {
    const { lifecycle, ports } = setup();
    const first = lifecycle.join(call.channelId);
    expect(lifecycle.join(call.channelId)).toBe(first);
    await expect(lifecycle.join('channel-2')).rejects.toThrow(
      'Already joining'
    );
    expect(ports.requestToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    await first;
    expect(ports.connect).toHaveBeenCalledExactlyOnceWith(token);
    expect(lifecycle.getState()).toEqual({ t: 'active', call });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes an answer only after the connection completes', async () => {
    const { lifecycle, ports } = setup();
    const connection = deferred<void>();
    ports.connect.mockReturnValueOnce(connection.promise);
    const onJoin = vi.fn();
    const promise = lifecycle.join(call.channelId, onJoin);
    expect(onJoin).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300);
    expect(ports.onJoined).not.toHaveBeenCalled();
    connection.resolve();
    await promise;
    expect(ports.onJoined).toHaveBeenCalledExactlyOnceWith(call);
    expect(ports.watch).toHaveBeenCalledOnce();
  });

  it('keeps the existing session when selecting its call tab again', async () => {
    const { lifecycle, ports, join } = setup();
    await join();
    const selectTab = vi.fn();
    await lifecycle.join(call.channelId, selectTab);
    expect(selectTab).toHaveBeenCalledOnce();
    expect(ports.connect).toHaveBeenCalledOnce();
    expect(ports.watch).toHaveBeenCalledOnce();
  });

  it('adopts an existing native session without requesting a token', async () => {
    const { lifecycle, ports } = setup();
    ports.shouldRequestToken.mockReturnValue(false);
    await lifecycle.join(call.channelId);
    expect(ports.requestToken).not.toHaveBeenCalled();
    expect(ports.connect).not.toHaveBeenCalled();
    expect(lifecycle.getState()).toEqual({ t: 'active', call });
    expect(ports.onJoined).toHaveBeenCalledExactlyOnceWith(call);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['joined', 'adopted'] as const)(
    'preserves the %s live call when another channel tries to join',
    async (origin) => {
      const { lifecycle, ports, join, unwatch, disconnect } = setup();
      if (origin === 'joined') await join();
      else lifecycle.syncSession(call);
      const tokenRequests = ports.requestToken.mock.calls.length;
      const onLeave = vi.fn();
      const onJoin = vi.fn();
      lifecycle.onLeave(onLeave);
      ports.requestToken.mockRejectedValueOnce(
        new ThrownResultError([
          { code: 'CONFLICT', message: 'Already in another call' },
        ])
      );
      await expect(lifecycle.join('channel-2', onJoin)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(300);
      expect(lifecycle.getState()).toEqual({ t: 'active', call });
      expect(ports.requestToken).toHaveBeenCalledTimes(tokenRequests);
      expect(ports.disconnect).not.toHaveBeenCalled();
      expect(ports.leave).not.toHaveBeenCalled();
      expect(unwatch).not.toHaveBeenCalled();
      expect(onLeave).not.toHaveBeenCalled();
      expect(onJoin).toHaveBeenCalledOnce();
      expect(ports.setError).toHaveBeenLastCalledWith(
        "You're already in another call. Leave your current call before joining a new one."
      );
      await lifecycle.join(call.channelId);
      expect(ports.setError).toHaveBeenLastCalledWith(null);
      disconnect(LK_DISCONNECT_REASON.CLIENT_INITIATED);
      expect(onLeave).toHaveBeenCalledExactlyOnceWith(call.channelId);
    }
  );

  it('releases a timed-out join while cleanup hangs, and ignores its late token', async () => {
    const { lifecycle, ports } = setup();
    const oldToken = deferred<CallTokenResponse>();
    const cleanup = deferred<void>();
    ports.requestToken.mockReturnValueOnce(oldToken.promise);
    ports.disconnect.mockReturnValueOnce(cleanup.promise);
    const failed = expect(lifecycle.join(call.channelId)).rejects.toThrow(
      'timed out'
    );
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    await failed;
    expect(lifecycle.getState().t).toBe('failed');
    expect(ports.rollbackJoin).toHaveBeenCalled();
    const retry = lifecycle.join(call.channelId);
    await vi.advanceTimersByTimeAsync(300);
    await retry;
    oldToken.resolve(token);
    cleanup.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.connect).toHaveBeenCalledOnce();
    expect(ports.leave).not.toHaveBeenCalled();
    expect(lifecycle.getState().t).toBe('active');
  });

  it('does not publish an answer for a connection that completed after cancellation', async () => {
    const { lifecycle, ports } = setup();
    const connection = deferred<void>();
    ports.connect.mockReturnValueOnce(connection.promise);
    const cancelled = expect(lifecycle.join(call.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    await lifecycle.leave(call.channelId);
    await cancelled;
    connection.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.onJoined).not.toHaveBeenCalled();
    expect(lifecycle.getState().t).toBe('idle');
  });

  it.each([
    {
      error: new ThrownResultError([
        { code: 'CONFLICT', message: 'Already in another call' },
      ]),
      message:
        "You're already in another call. Leave your current call before joining a new one.",
    },
    {
      error: new Error('Network unavailable'),
      message: 'Unable to join the call. Please check your connection.',
    },
  ])(
    'preserves join failures and displays $message',
    async ({ error, message }) => {
      const { lifecycle, ports } = setup();
      ports.requestToken.mockRejectedValueOnce(error);
      await expect(lifecycle.join(call.channelId)).rejects.toBe(error);
      expect(lifecycle.getState()).toEqual({
        t: 'failed',
        channelId: call.channelId,
        error,
      });
      expect(ports.setError).toHaveBeenLastCalledWith(message);
    }
  );

  it('cancels a pending join when native confirms the session ended', async () => {
    const { lifecycle, ports } = setup();
    const pending = deferred<CallTokenResponse>();
    ports.requestToken.mockReturnValueOnce(pending.promise);
    const cancelled = expect(lifecycle.join(call.channelId)).rejects.toThrow(
      'cancelled'
    );
    lifecycle.syncSession(undefined);
    await cancelled;
    expect(lifecycle.getState().t).toBe('idle');
    expect(ports.setError).toHaveBeenLastCalledWith(null);
    pending.resolve(token);
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
    expect(ports.connect).not.toHaveBeenCalled();
    expect(ports.onJoined).not.toHaveBeenCalled();
  });

  it.each([0, 300])(
    'leaves server membership when native cancels %s ms after requesting a token',
    async (elapsed) => {
      const { lifecycle, ports } = setup();
      let participantRegistered = false;
      ports.requestToken.mockImplementationOnce(async () => {
        participantRegistered = true;
        return token;
      });
      ports.leave.mockImplementationOnce(async () => {
        participantRegistered = false;
      });
      const connection = deferred<void>();
      ports.connect.mockReturnValueOnce(connection.promise);
      const cancelled = expect(lifecycle.join(call.channelId)).rejects.toThrow(
        'cancelled'
      );
      await vi.advanceTimersByTimeAsync(elapsed);
      expect(participantRegistered).toBe(true);
      lifecycle.syncSession(undefined);
      lifecycle.syncSession(undefined);
      await cancelled;
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.disconnect).toHaveBeenCalledExactlyOnceWith({
        endNativeCall: false,
      });
      expect(ports.leave).toHaveBeenCalledExactlyOnceWith(call.channelId);
      expect(participantRegistered).toBe(false);
      expect(lifecycle.getState().t).toBe('idle');
      connection.resolve();
      await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS);
      expect(ports.onJoined).not.toHaveBeenCalled();
      expect(ports.leave).toHaveBeenCalledOnce();
    }
  );

  it('leaves server membership even if native cancellation disconnect fails', async () => {
    const { lifecycle, ports } = setup();
    const failure = new Error('transport cleanup failed');
    ports.disconnect.mockRejectedValueOnce(failure);
    const connection = deferred<void>();
    ports.connect.mockReturnValueOnce(connection.promise);
    const cancelled = expect(lifecycle.join(call.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    lifecycle.syncSession(undefined);
    await cancelled;
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.leave).toHaveBeenCalledExactlyOnceWith(call.channelId);
    expect(ports.reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(lifecycle.getState().t).toBe('idle');
    connection.resolve();
  });

  it('detaches the session listener before explicit leave and shares duplicate leaves', async () => {
    const { lifecycle, ports, unwatch, disconnect, join } = setup();
    await join();
    const serverLeave = deferred<void>();
    ports.leave.mockReturnValueOnce(serverLeave.promise);
    const onLeave = vi.fn();
    lifecycle.onLeave(onLeave);
    const first = lifecycle.leave(call.channelId);
    expect(lifecycle.leave(call.channelId)).toBe(first);
    expect(unwatch).toHaveBeenCalledOnce();
    disconnect(); // An emitter may already have captured its listener list.
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.lookup).not.toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalledExactlyOnceWith(call.channelId);
    serverLeave.resolve();
    await first;
    expect(ports.disconnect).toHaveBeenCalledOnce();
    expect(ports.leave).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the channel view before slow media teardown completes', async () => {
    const { lifecycle, ports, join } = setup();
    await join();
    const teardown = deferred<void>();
    ports.disconnect.mockReturnValueOnce(teardown.promise);
    const onLeave = vi.fn();
    lifecycle.onLeave(onLeave);
    const leaving = lifecycle.leave(call.channelId);
    expect(onLeave).toHaveBeenCalledExactlyOnceWith(call.channelId);
    expect(ports.leave).not.toHaveBeenCalled();
    teardown.resolve();
    await leaving;
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('handles native call end through the same leave lifecycle', async () => {
    const { ports, nativeEnd, join } = setup();
    await join();
    nativeEnd();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.disconnect).toHaveBeenCalledExactlyOnceWith({
      endNativeCall: false,
    });
    expect(ports.leave).toHaveBeenCalledExactlyOnceWith(call.channelId);
  });

  it('rejoins only the same live call after a transport disconnect', async () => {
    const { lifecycle, ports, unwatch, disconnect, join } = setup();
    await join();
    disconnect();
    expect(unwatch).toHaveBeenCalledOnce();
    expect(lifecycle.getState().t).toBe('retry-wait');
    await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS + 300);
    expect(ports.lookup).toHaveBeenCalledExactlyOnceWith(call.channelId);
    expect(ports.connect).toHaveBeenCalledTimes(2);
    expect(lifecycle.getState()).toEqual({ t: 'active', call });
  });

  it.each([null, 'unavailable', { callId: 'replacement' }] as const)(
    'never starts a new call when recovery lookup returns %s',
    async (result) => {
      const { lifecycle, ports, disconnect, join } = setup();
      await join();
      ports.lookup.mockResolvedValueOnce(result);
      disconnect();
      await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS);
      expect(ports.requestToken).toHaveBeenCalledOnce();
      expect(lifecycle.getState().t).toBe('idle');
    }
  );

  it.each(Object.values(LK_DISCONNECT_REASON))(
    'does not recover intentional disconnect reason %s',
    async (reason) => {
      const { lifecycle, ports, disconnect, join } = setup();
      await join();
      const onLeave = vi.fn();
      lifecycle.onLeave(onLeave);
      disconnect(reason);
      expect(onLeave).toHaveBeenCalledOnce();
      expect(lifecycle.getState().t).toBe('idle');
      await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS);
      expect(ports.lookup).not.toHaveBeenCalled();
    }
  );

  it('cancels pending recovery when the user leaves during its lookup', async () => {
    const { lifecycle, ports, disconnect, join } = setup();
    await join();
    const lookup = deferred<ActiveCallLookup>();
    ports.lookup.mockReturnValueOnce(lookup.promise);
    disconnect();
    await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS);
    await lifecycle.leave(call.channelId);
    lookup.resolve({ callId: call.callId });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.requestToken).toHaveBeenCalledOnce();
    expect(lifecycle.getState().t).toBe('idle');
  });

  it.each(['retry-wait', 'checking'] as const)(
    'cancels recovery when native ends during %s',
    async (phase) => {
      const { lifecycle, ports, disconnect, join } = setup();
      await join();
      const lookup = deferred<ActiveCallLookup>();
      ports.lookup.mockReturnValueOnce(lookup.promise);
      const onLeave = vi.fn();
      lifecycle.onLeave(onLeave);
      disconnect();
      if (phase === 'checking')
        await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS);
      expect(lifecycle.getState().t).toBe(phase);
      lifecycle.syncSession(undefined);
      lifecycle.syncSession(undefined);
      expect(lifecycle.getState().t).toBe('idle');
      expect(ports.setError).toHaveBeenLastCalledWith(null);
      expect(onLeave).toHaveBeenCalledExactlyOnceWith(call.channelId);
      lookup.resolve({ callId: call.callId });
      await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS + 300);
      expect(ports.requestToken).toHaveBeenCalledOnce();
    }
  );

  it('clears the recovery error when a live native session is adopted', async () => {
    const { lifecycle, ports, disconnect, join } = setup();
    await join();
    disconnect();
    expect(ports.setError).toHaveBeenLastCalledWith(
      'Call disconnected. Reconnecting…'
    );
    lifecycle.syncSession(call);
    expect(lifecycle.getState()).toEqual({ t: 'active', call });
    expect(ports.setError).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS);
    expect(ports.lookup).not.toHaveBeenCalled();
  });

  it('refuses recovery after sleep, including a lookup frozen in flight', async () => {
    const { lifecycle, ports, disconnect, join } = setup();
    await join();
    const lookup = deferred<ActiveCallLookup>();
    ports.lookup.mockReturnValueOnce(lookup.promise);
    disconnect();
    await vi.advanceTimersByTimeAsync(AUTO_REJOIN_DELAY_MS);
    vi.setSystemTime(Date.now() + 60_000);
    lookup.resolve({ callId: call.callId });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.requestToken).toHaveBeenCalledOnce();
    expect(lifecycle.getState().t).toBe('idle');
  });

  it.each([LEAVE_TIMEOUT_MS + 1, -1])(
    'allows a resumed leave after a wall-clock jump of %s ms',
    async (jump) => {
      const { lifecycle, ports } = setup();
      const oldDisconnect = deferred<void>();
      ports.disconnect.mockReturnValueOnce(oldDisconnect.promise);
      const oldLeave = expect(lifecycle.leave(call.channelId)).rejects.toThrow(
        'cancelled'
      );
      vi.setSystemTime(Date.now() + jump);
      await lifecycle.leave(call.channelId);
      await oldLeave;
      oldDisconnect.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.disconnect).toHaveBeenCalledTimes(2);
      expect(ports.leave).toHaveBeenCalledOnce();
      expect(ports.onLeft).toHaveBeenCalledOnce();
    }
  );

  it('times out a hung leave and permits a new join', async () => {
    const { lifecycle, ports, join } = setup();
    ports.disconnect.mockReturnValueOnce(new Promise(() => {}));
    const failed = expect(lifecycle.leave(call.channelId)).rejects.toThrow(
      'timed out'
    );
    await vi.advanceTimersByTimeAsync(LEAVE_TIMEOUT_MS);
    await failed;
    await join();
    expect(lifecycle.getState().t).toBe('active');
  });

  it('owns exactly one listener for an adopted session and cleans it on disposal', async () => {
    const { lifecycle, ports, unwatch, disconnect } = setup();
    lifecycle.syncSession(call);
    lifecycle.syncSession(call);
    expect(ports.watch).toHaveBeenCalledOnce();
    lifecycle.dispose();
    disconnect();
    expect(unwatch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(lifecycle.join(call.channelId)).rejects.toThrow('disposed');
    await expect(lifecycle.leave(call.channelId)).rejects.toThrow('disposed');
  });

  it('can join again after foreground sync clears a native call that ended while suspended', async () => {
    const { lifecycle, ports, unwatch, join } = setup();
    const onLeave = vi.fn();
    lifecycle.onLeave(onLeave);
    lifecycle.syncSession(call);
    lifecycle.syncSession(undefined);
    lifecycle.syncSession(undefined);
    expect(lifecycle.getState().t).toBe('idle');
    expect(unwatch).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledExactlyOnceWith(call.channelId);
    await join();
    expect(ports.requestToken).toHaveBeenCalledOnce();
    expect(ports.connect).toHaveBeenCalledOnce();
    expect(lifecycle.getState()).toEqual({ t: 'active', call });
  });
});
