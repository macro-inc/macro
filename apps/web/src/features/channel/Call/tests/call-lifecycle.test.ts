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
const token = {
  ...call,
  roomName: 'room-1',
  token: 'token',
  serverUrl: 'ws://localhost',
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
