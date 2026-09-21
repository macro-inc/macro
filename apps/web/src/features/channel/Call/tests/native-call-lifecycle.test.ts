import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCallLookup } from '../auto-rejoin';
import { createCallLifecycle, LEAVE_TIMEOUT_MS } from '../call-lifecycle';
import { bindNativeCallLifecycle } from '../native-call-lifecycle';
import {
  createNativeCallState,
  type NativeCallSnapshot,
} from '../native-call-state';

vi.mock('../callkit-drawer-theme', () => ({
  createCallKitDrawerTheme: () => () => ({}),
}));

const first: NativeCallSnapshot = {
  channelId: 'channel-1',
  callId: 'call-1',
  connectionState: 'connected',
  isAudioMuted: false,
  isVideoMuted: true,
  videoOverlayMode: 'hidden',
};
const second: NativeCallSnapshot = {
  ...first,
  channelId: 'channel-2',
  callId: 'call-2',
};
const identity = (call: NativeCallSnapshot) => ({
  channelId: call.channelId,
  callId: call.callId,
});
const cleanups: (() => void)[] = [];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(initial: NativeCallSnapshot | null = first) {
  return createRoot((dispose) => {
    const native = createNativeCallState();
    native.setSnapshot(initial);
    const unwatch = vi.fn();
    const ports = {
      shouldRequestToken: vi.fn((_channelId: string) => true),
      requestToken: vi.fn(async () => ({
        ...identity(first),
        roomName: 'room-1',
        token: 'token',
        serverUrl: 'ws://localhost',
      })),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn<
        Parameters<typeof createCallLifecycle>[0]['disconnect']
      >(async () => {
        native.setSnapshot(null);
      }),
      leave: vi.fn(async () => {}),
      lookup: vi.fn<() => Promise<ActiveCallLookup>>(async () => ({
        callId: first.callId,
      })),
      currentCall: () => {
        const snapshot = native.snapshot();
        return snapshot ? identity(snapshot) : undefined;
      },
      beginJoin: vi.fn(),
      rollbackJoin: vi.fn(),
      setError: vi.fn(),
      watch: vi.fn(() => unwatch),
      onJoined: vi.fn(),
      onLeft: vi.fn(),
      reportError: vi.fn(),
    } satisfies Parameters<typeof createCallLifecycle>[0];
    const lifecycle = createCallLifecycle(ports);
    const unbind = bindNativeCallLifecycle(native, lifecycle);
    cleanups.push(() => {
      unbind();
      lifecycle.dispose();
      dispose();
    });
    return { native, lifecycle, ports, unwatch, unbind, dispose };
  });
}

describe('native snapshot events and call ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
  });

  it('adopts an existing native call at setup and preserves its watcher through media updates', () => {
    const { native, lifecycle, ports } = setup();
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(first),
    });
    const updated = native.setSnapshot(
      (snapshot) => snapshot && { ...snapshot, isAudioMuted: true }
    );
    expect(updated?.isAudioMuted).toBe(true);
    expect(native.snapshot()).toBe(updated);
    expect(ports.watch).toHaveBeenCalledOnce();
    expect(ports.connect).not.toHaveBeenCalled();
    expect(ports.onJoined).not.toHaveBeenCalled();
  });

  it('reconciles a missed native end immediately without waiting for a Solid effect', () => {
    const { native, lifecycle, unwatch } = setup();
    const onLeave = vi.fn();
    lifecycle.onLeave(onLeave);
    native.setSnapshot(null);
    expect(lifecycle.getState().t).toBe('idle');
    expect(unwatch).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledExactlyOnceWith(first.channelId);
    native.setSnapshot(null);
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('keeps native reconnecting snapshots under the existing call lifetime', () => {
    const { native, lifecycle, ports } = setup();
    native.setSnapshot({ ...first, connectionState: 'reconnecting' });
    native.setSnapshot(first);
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(first),
    });
    expect(ports.watch).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject', 'timeout'] as const)(
    'adopts a newer native call after an old server leave completes with %s',
    async (completion) => {
      const { native, lifecycle, ports } = setup();
      const pending = deferred();
      ports.leave.mockReturnValueOnce(pending.promise);
      const leaving = lifecycle.leave(first.channelId);
      const result =
        completion === 'resolve'
          ? expect(leaving).resolves.toBeUndefined()
          : expect(leaving).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      native.setSnapshot(second);
      expect(lifecycle.getState().t).toBe('leaving');
      if (completion === 'resolve') pending.resolve();
      else if (completion === 'reject') pending.reject(new Error('offline'));
      else await vi.advanceTimersByTimeAsync(LEAVE_TIMEOUT_MS);
      await result;
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(second),
      });
      expect(ports.watch).toHaveBeenCalledTimes(2);
      expect(ports.watch).toHaveBeenLastCalledWith(
        identity(second),
        expect.any(Function),
        expect.any(Function)
      );
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(second),
      });
    }
  );

  it('preserves a newer native call arriving before transport cleanup finishes', async () => {
    const { native, lifecycle, ports } = setup();
    const pending = deferred();
    ports.disconnect.mockImplementationOnce(() => pending.promise);
    const leaving = lifecycle.leave(first.channelId);
    native.setSnapshot(second);
    pending.resolve();
    await leaving;
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(second),
    });
    expect(ports.leave).toHaveBeenCalledExactlyOnceWith(first.channelId);
  });

  it('does not resurrect a replacement that also ends while leave is pending', async () => {
    const { native, lifecycle, ports } = setup();
    const pending = deferred();
    ports.leave.mockReturnValueOnce(pending.promise);
    const leaving = lifecycle.leave(first.channelId);
    await vi.advanceTimersByTimeAsync(0);
    native.setSnapshot(second);
    native.setSnapshot(null);
    pending.resolve();
    await leaving;
    expect(lifecycle.getState().t).toBe('idle');
    expect(ports.watch).toHaveBeenCalledOnce();
  });

  it('removes both subscriptions on disposal, including reconciliation after leave', async () => {
    const { native, lifecycle, ports, unbind } = setup();
    const pending = deferred();
    ports.leave.mockReturnValueOnce(pending.promise);
    const leaving = lifecycle.leave(first.channelId);
    await vi.advanceTimersByTimeAsync(0);
    unbind();
    native.setSnapshot(second);
    pending.resolve();
    await leaving;
    expect(lifecycle.getState().t).toBe('idle');
    native.setSnapshot(first);
    expect(ports.watch).toHaveBeenCalledOnce();
  });

  it('releases native snapshot listeners with their provider owner', () => {
    const { native, dispose } = setup(null);
    const listener = vi.fn();
    native.onSnapshot(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
    dispose();
    native.setSnapshot(first);
    expect(listener).toHaveBeenCalledOnce();
  });

  it.each(['connecting', 'connected'] as const)(
    'cancels a native %s session that ends before start resolves',
    async (connectionState) => {
      const { native, lifecycle, ports } = setup(null);
      const pending = deferred();
      ports.connect.mockReturnValueOnce(pending.promise);
      const joining = lifecycle.join(first.channelId);
      const cancelled = expect(joining).rejects.toThrow('cancelled');
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot({ ...first, connectionState });
      native.setSnapshot(null);
      await cancelled;
      await vi.advanceTimersByTimeAsync(0);
      expect(lifecycle.getState()).toEqual({ t: 'idle' });
      expect(ports.disconnect).toHaveBeenCalledExactlyOnceWith({
        endNativeCall: false,
      });
      expect(ports.leave).toHaveBeenCalledExactlyOnceWith(first.channelId);
      pending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.onJoined).not.toHaveBeenCalled();
      const retry = lifecycle.join(first.channelId);
      await vi.advanceTimersByTimeAsync(300);
      await retry;
      expect(ports.requestToken).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['resolve', 'reject', 'timeout'] as const)(
    'preserves a new native call when cancelled-join cleanup finishes with %s',
    async (completion) => {
      const { native, lifecycle, ports } = setup(null);
      const connection = deferred();
      const cleanup = deferred();
      ports.connect.mockReturnValueOnce(connection.promise);
      ports.leave.mockReturnValueOnce(cleanup.promise);
      const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
        'cancelled'
      );
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot({ ...first, connectionState: 'connecting' });
      native.setSnapshot(null);
      await cancelled;
      await vi.advanceTimersByTimeAsync(0);
      expect(lifecycle.getState().t).toBe('leaving');
      expect(ports.leave).toHaveBeenCalledExactlyOnceWith(first.channelId);
      native.setSnapshot(second);
      if (completion === 'resolve') cleanup.resolve();
      else if (completion === 'reject') cleanup.reject(new Error('offline'));
      else await vi.advanceTimersByTimeAsync(LEAVE_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(second),
      });
      expect(ports.watch).toHaveBeenCalledExactlyOnceWith(
        identity(second),
        expect.any(Function),
        expect.any(Function)
      );
      expect(ports.reportError).toHaveBeenCalledTimes(
        completion === 'resolve' ? 0 : 1
      );
      connection.resolve();
      cleanup.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.onJoined).not.toHaveBeenCalled();
      expect(ports.leave).toHaveBeenCalledOnce();
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(second),
      });
    }
  );

  it.each([first, { ...first, callId: 'replacement' }])(
    'keeps restored membership in $callId when native cancellation cleanup is superseded',
    async (restored) => {
      const { native, lifecycle, ports } = setup(null);
      const connection = deferred();
      const cleanup = deferred();
      let member = true;
      ports.connect.mockReturnValueOnce(connection.promise);
      ports.disconnect.mockReturnValueOnce(cleanup.promise);
      ports.leave.mockImplementationOnce(async () => {
        member = false;
      });
      const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
        'cancelled'
      );
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot({ ...first, connectionState: 'connecting' });
      native.setSnapshot(null);
      await cancelled;
      native.setSnapshot(restored);
      cleanup.resolve();
      connection.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(member).toBe(true);
      expect(ports.leave).not.toHaveBeenCalled();
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(restored),
      });
      expect(ports.watch).toHaveBeenCalledOnce();
      expect(ports.onJoined).not.toHaveBeenCalled();
      expect(ports.reportError).not.toHaveBeenCalled();
    }
  );

  it('accepts a retry while native cancellation transport cleanup is still pending', async () => {
    const { native, lifecycle, ports } = setup(null);
    const connection = deferred();
    const cleanup = deferred();
    ports.connect.mockReturnValueOnce(connection.promise);
    ports.disconnect.mockReturnValueOnce(cleanup.promise);
    const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot({ ...first, connectionState: 'connecting' });
    native.setSnapshot(null);
    await cancelled;
    const retry = expect(
      lifecycle.join(first.channelId)
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    await retry;
    cleanup.resolve();
    connection.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.requestToken).toHaveBeenCalledTimes(2);
    expect(ports.leave).not.toHaveBeenCalled();
    expect(ports.onJoined).toHaveBeenCalledOnce();
    expect(ports.reportError).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'accepts a retry after an already-sent cancellation leave completes with %s',
    async (completion) => {
      const { native, lifecycle, ports } = setup(null);
      const connection = deferred();
      const cleanup = deferred();
      ports.connect.mockReturnValueOnce(connection.promise);
      ports.leave.mockReturnValueOnce(cleanup.promise);
      const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
        'cancelled'
      );
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot({ ...first, connectionState: 'connecting' });
      native.setSnapshot(null);
      await cancelled;
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.leave).toHaveBeenCalledOnce();
      const retry = lifecycle.join(first.channelId);
      const joined = expect(retry).resolves.toBeUndefined();
      expect(lifecycle.join(first.channelId)).toBe(retry);
      await vi.advanceTimersByTimeAsync(300);
      expect(ports.requestToken).toHaveBeenCalledOnce();
      if (completion === 'resolve') cleanup.resolve();
      else cleanup.reject(new Error('offline'));
      await joined;
      expect(ports.requestToken).toHaveBeenCalledTimes(2);
      expect(ports.onJoined).toHaveBeenCalledOnce();
      connection.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.onJoined).toHaveBeenCalledOnce();
    }
  );

  it.each([
    { manualRetry: false, callId: first.callId },
    { manualRetry: true, callId: first.callId },
    { manualRetry: false, callId: '01991b2a-f4e0-7000-a000-111111111111' },
  ])(
    'renews restored native membership after a sent leave (manual retry: $manualRetry, call: $callId)',
    async ({ manualRetry, callId }) => {
      const { native, lifecycle, ports } = setup(null);
      const restored = { ...first, callId: callId.toUpperCase() };
      ports.lookup.mockResolvedValue({ callId });
      const connection = deferred();
      const cleanup = deferred();
      let member = false;
      ports.shouldRequestToken.mockImplementation((channelId) => {
        const snapshot = native.snapshot();
        return (
          !snapshot ||
          snapshot.channelId !== channelId ||
          snapshot.connectionState === 'disconnected' ||
          snapshot.connectionState === 'disconnecting'
        );
      });
      ports.requestToken.mockImplementation(async () => {
        member = true;
        return {
          ...identity(first),
          callId,
          roomName: 'room-1',
          token: 'token',
          serverUrl: 'ws://localhost',
        };
      });
      ports.connect.mockReturnValueOnce(connection.promise);
      ports.leave.mockImplementationOnce(async () => {
        await cleanup.promise;
        member = false;
      });
      const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
        'cancelled'
      );
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot({ ...first, connectionState: 'connecting' });
      native.setSnapshot(null);
      await cancelled;
      await vi.advanceTimersByTimeAsync(0);
      const retry = manualRetry ? lifecycle.join(first.channelId) : undefined;
      native.setSnapshot(restored);
      await vi.advanceTimersByTimeAsync(300);
      expect(ports.requestToken).toHaveBeenCalledOnce();
      cleanup.resolve();
      await retry;
      await vi.advanceTimersByTimeAsync(0);
      expect(member).toBe(true);
      expect(ports.requestToken).toHaveBeenCalledTimes(2);
      expect(ports.connect).toHaveBeenCalledOnce();
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: { ...identity(first), callId },
      });
      expect(ports.watch).toHaveBeenCalledOnce();
      connection.resolve();
    }
  );

  it('cleans up if renewal returns a different call from the restored native session', async () => {
    const { native, lifecycle, ports } = setup(null);
    const connection = deferred();
    const cleanup = deferred();
    ports.connect.mockReturnValueOnce(connection.promise);
    ports.leave.mockReturnValueOnce(cleanup.promise);
    const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot({ ...first, connectionState: 'connecting' });
    native.setSnapshot(null);
    await cancelled;
    await vi.advanceTimersByTimeAsync(0);
    ports.shouldRequestToken.mockReturnValue(false);
    ports.requestToken.mockResolvedValueOnce({
      ...identity(first),
      callId: 'new-server-call',
      roomName: 'room-1',
      token: 'new-token',
      serverUrl: 'ws://localhost',
    });
    native.setSnapshot(first);
    cleanup.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(lifecycle.getState().t).toBe('idle');
    expect(native.snapshot()).toBeNull();
    expect(ports.connect).toHaveBeenCalledOnce();
    expect(ports.leave).toHaveBeenCalledTimes(2);
    expect(ports.disconnect).toHaveBeenLastCalledWith({ endNativeCall: true });
    expect(ports.watch).not.toHaveBeenCalled();
    expect(ports.onJoined).not.toHaveBeenCalled();
    connection.resolve();
  });

  it.each([
    null,
    'unavailable',
    { callId: 'replacement' },
    new Error('lookup offline'),
  ] as const)(
    'never recreates a native call when automatic renewal lookup returns %j',
    async (result) => {
      const { native, lifecycle, ports } = setup(null);
      const connection = deferred();
      const cleanup = deferred();
      ports.connect.mockReturnValueOnce(connection.promise);
      ports.leave.mockReturnValueOnce(cleanup.promise);
      if (result instanceof Error) ports.lookup.mockRejectedValueOnce(result);
      else ports.lookup.mockResolvedValueOnce(result);
      const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
        'cancelled'
      );
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot({ ...first, connectionState: 'connecting' });
      native.setSnapshot(null);
      await cancelled;
      await vi.advanceTimersByTimeAsync(0);
      native.setSnapshot(first);
      cleanup.resolve();
      await vi.advanceTimersByTimeAsync(300);
      expect(ports.requestToken).toHaveBeenCalledOnce();
      expect(ports.connect).toHaveBeenCalledOnce();
      expect(ports.onJoined).not.toHaveBeenCalled();
      expect(ports.leave).toHaveBeenCalledOnce();
      expect(lifecycle.getState().t).toBe('idle');
      connection.resolve();
    }
  );

  it('does not end a different native channel that arrives during a renewal request', async () => {
    const { native, lifecycle, ports } = setup(null);
    const connection = deferred();
    const cleanup = deferred();
    const renewal = deferred();
    ports.connect.mockReturnValueOnce(connection.promise);
    ports.leave.mockReturnValueOnce(cleanup.promise);
    const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot({ ...first, connectionState: 'connecting' });
    native.setSnapshot(null);
    await cancelled;
    await vi.advanceTimersByTimeAsync(0);
    ports.shouldRequestToken.mockReturnValue(false);
    ports.requestToken.mockImplementationOnce(async () => {
      await renewal.promise;
      return {
        ...identity(first),
        callId: 'new-server-call',
        roomName: 'room-1',
        token: 'new-token',
        serverUrl: 'ws://localhost',
      };
    });
    ports.disconnect.mockImplementationOnce(async (options) => {
      if (options?.endNativeCall !== false) native.setSnapshot(null);
    });
    native.setSnapshot(first);
    cleanup.resolve();
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot(second);
    renewal.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.disconnect).toHaveBeenLastCalledWith({ endNativeCall: false });
    expect(native.snapshot()).toEqual(second);
    expect(ports.leave).toHaveBeenLastCalledWith(first.channelId);
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(second),
    });
    connection.resolve();
  });

  it('does not renew a restored session that ends while its old leave is pending', async () => {
    const { native, lifecycle, ports } = setup(null);
    const connection = deferred();
    const cleanup = deferred();
    ports.connect.mockReturnValueOnce(connection.promise);
    ports.leave.mockReturnValueOnce(cleanup.promise);
    const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot({ ...first, connectionState: 'connecting' });
    native.setSnapshot(null);
    await cancelled;
    await vi.advanceTimersByTimeAsync(0);
    native.setSnapshot(first);
    native.setSnapshot(null);
    cleanup.resolve();
    connection.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(ports.requestToken).toHaveBeenCalledOnce();
    expect(ports.onJoined).not.toHaveBeenCalled();
    expect(lifecycle.getState().t).toBe('idle');
  });

  it('finishes the old channel cleanup before following a different native channel', async () => {
    const { native, lifecycle, ports } = setup(null);
    const connection = deferred();
    const cleanup = deferred();
    ports.connect.mockReturnValueOnce(connection.promise);
    ports.disconnect.mockReturnValueOnce(cleanup.promise);
    const cancelled = expect(lifecycle.join(first.channelId)).rejects.toThrow(
      'cancelled'
    );
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot({ ...first, connectionState: 'connecting' });
    native.setSnapshot(null);
    await cancelled;
    await expect(lifecycle.join(second.channelId)).rejects.toThrow(
      'still leaving'
    );
    native.setSnapshot(second);
    cleanup.resolve();
    connection.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.leave).toHaveBeenCalledExactlyOnceWith(first.channelId);
    expect(ports.requestToken).toHaveBeenCalledOnce();
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(second),
    });
  });

  it('adopts a native replacement before the old start transaction resolves', async () => {
    const { native, lifecycle, ports } = setup(null);
    const pending = deferred();
    ports.connect.mockReturnValueOnce(pending.promise);
    const joining = lifecycle.join(first.channelId);
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot(first);
    native.setSnapshot(second);
    pending.resolve();
    await joining;
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(second),
    });
    expect(ports.onJoined).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...second, connectionState: 'disconnected' as const },
    { ...second, connectionState: 'disconnecting' as const },
  ])(
    'ignores an empty or stale ended snapshot while native start is pending (%j)',
    async (snapshot) => {
      const { native, lifecycle, ports } = setup(null);
      const pending = deferred();
      ports.connect.mockReturnValueOnce(pending.promise);
      const joining = lifecycle.join(first.channelId);
      await vi.advanceTimersByTimeAsync(300);
      native.setSnapshot(snapshot);
      pending.resolve();
      await joining;
      // Start can resolve before the first media snapshot, so another empty
      // notification must not end the acknowledged call either.
      native.setSnapshot(snapshot);
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(first),
      });
      expect(ports.onJoined).toHaveBeenCalledExactlyOnceWith(identity(first));
      expect(ports.disconnect).not.toHaveBeenCalled();
      expect(ports.leave).not.toHaveBeenCalled();
    }
  );

  it.each(['disconnected', 'disconnecting'] as const)(
    'allows a real new join while the old native snapshot is %s',
    async (connectionState) => {
      const { native, lifecycle, ports } = setup();
      native.setSnapshot({ ...first, connectionState });
      expect(lifecycle.getState().t).toBe('idle');
      const joining = lifecycle.join(first.channelId);
      await vi.advanceTimersByTimeAsync(300);
      await joining;
      expect(ports.requestToken).toHaveBeenCalledExactlyOnceWith(
        first.channelId
      );
      expect(ports.connect).toHaveBeenCalledOnce();
      expect(lifecycle.getState()).toEqual({
        t: 'active',
        call: identity(first),
      });
    }
  );

  it('does not treat the initial missing snapshot as an end while starting a native call', async () => {
    const { lifecycle, ports } = setup(null);
    const joining = lifecycle.join(first.channelId);
    await vi.advanceTimersByTimeAsync(300);
    await joining;
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(first),
    });
    expect(ports.onJoined).toHaveBeenCalledOnce();
  });

  it('adopts a native replacement when an old start transaction rejects', async () => {
    const { native, lifecycle, ports } = setup(null);
    const pending = deferred();
    ports.connect.mockReturnValueOnce(pending.promise);
    // The native controller preserves a different call during failed cleanup.
    ports.disconnect.mockImplementationOnce(async () => {});
    const joining = lifecycle.join(first.channelId);
    const rejected = expect(joining).rejects.toThrow('already active');
    await vi.advanceTimersByTimeAsync(300);
    native.setSnapshot(second);
    pending.reject(new Error('already active'));
    await rejected;
    expect(lifecycle.getState()).toEqual({
      t: 'active',
      call: identity(second),
    });
    expect(ports.watch).toHaveBeenCalledOnce();
    expect(ports.leave).not.toHaveBeenCalled();
    expect(ports.setError).toHaveBeenLastCalledWith(null);
  });
});
