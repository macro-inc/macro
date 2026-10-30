import {
  finishNotificationNavigation,
  pendingNotificationNavigation,
  receiveNotificationTap,
  setPendingNotificationNavigationId,
} from '@notifications/notification-navigation-intent';
import { endNotificationOpen } from '@notifications/notification-open-trace';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import {
  prepareNotificationLaunch,
  useNotificationCoverTimeout,
} from './notification-launch';
import type { PushEvent } from './push-api';

const bridge = vi.hoisted(() => ({
  supported: true,
  watch: vi.fn(),
  pending: vi.fn(),
  acknowledge: vi.fn(),
  releaseCover: vi.fn(),
}));
vi.mock('./push-api', () => ({
  supportsNotificationLaunch: () => bridge.supported,
  createPushApi: () => bridge,
  releaseNotificationCover: bridge.releaseCover,
}));

beforeEach(() => {
  vi.useFakeTimers();
  bridge.supported = true;
  bridge.watch.mockResolvedValue(undefined);
  bridge.pending.mockResolvedValue(null);
  bridge.acknowledge.mockResolvedValue(undefined);
  bridge.releaseCover.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/app/#/channels/previous-channel');
});
afterEach(() => {
  vi.resetAllMocks();
  setPendingNotificationNavigationId(undefined);
  endNotificationOpen('test_complete');
  vi.useRealTimers();
});

it('captures a cold-launch tap before the router restores the previous channel', async () => {
  bridge.pending.mockResolvedValue({
    type: 'BACKGROUND_TAP',
    payload: { notificationId: 'notification' },
    deliveryId: 'cold-launch',
  });
  await prepareNotificationLaunch();
  expect(bridge.watch.mock.invocationCallOrder[0]).toBeLessThan(
    bridge.pending.mock.invocationCallOrder[0]
  );
  expect(window.location.hash).toBe('#/');
  expect(pendingNotificationNavigation()?.notificationId).toBe('notification');
  expect(bridge.acknowledge).not.toHaveBeenCalled();
});

it('keeps ordinary icon launches on their restored route', async () => {
  await prepareNotificationLaunch();
  expect(window.location.hash).toBe('#/channels/previous-channel');
  expect(vi.getTimerCount()).toBe(0);
  expect(bridge.releaseCover).not.toHaveBeenCalled();
});

it('does not call new native commands on older iOS binaries', async () => {
  bridge.supported = false;
  await prepareNotificationLaunch();
  expect(bridge.watch).not.toHaveBeenCalled();
  expect(bridge.pending).not.toHaveBeenCalled();
});

it.each(['watch', 'pending'] as const)(
  'releases startup after a stalled %s and queues late taps without resetting the live route',
  async (phase) => {
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tap: PushEvent = {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'late-notification' },
      deliveryId: 'late-delivery',
    };
    bridge.watch.mockImplementation(async () => {
      if (phase === 'watch') await stalled;
    });
    bridge.pending.mockImplementation(async () => {
      if (phase === 'pending') await stalled;
      return tap;
    });
    // A stalled cover-release command must not become a second startup gate.
    bridge.releaseCover.mockImplementation(() => new Promise(() => {}));
    const finished = vi.fn();
    const launch = (async () => {
      await prepareNotificationLaunch();
      finished();
    })();
    await vi.advanceTimersByTimeAsync(1499);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toHaveBeenCalledOnce();
    await launch;
    expect(bridge.releaseCover).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/channels/previous-channel');

    window.history.replaceState(null, '', '/app/#/channels/current-channel');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingNotificationNavigation()?.notificationId).toBe(
      'late-notification'
    );
    expect(window.location.hash).toBe('#/channels/current-channel');
    expect(bridge.acknowledge).not.toHaveBeenCalled();
  }
);

function mountCoverTimeout() {
  return createRoot((dispose) => {
    useNotificationCoverTimeout();
    onTestFinished(dispose);
    return dispose;
  });
}

it('releases a stalled warm tap without consuming it or extending the deadline on redelivery', async () => {
  mountCoverTimeout();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(bridge.releaseCover).toHaveBeenCalledOnce();
  bridge.releaseCover.mockClear();

  const tap = {
    type: 'BACKGROUND_TAP',
    payload: { notificationId: 'notification' },
    deliveryId: 'warm-tap',
  };
  receiveNotificationTap(tap, bridge.acknowledge);
  const intent = pendingNotificationNavigation();
  await vi.advanceTimersByTimeAsync(7000);
  receiveNotificationTap(tap, bridge.acknowledge);
  await vi.advanceTimersByTimeAsync(999);
  expect(bridge.releaseCover).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(bridge.releaseCover).toHaveBeenCalledOnce();
  expect(pendingNotificationNavigation()).toBe(intent);
  expect(bridge.acknowledge).not.toHaveBeenCalled();
});

it('reveals the app while an acknowledgment is stalled and still accepts its late completion', async () => {
  mountCoverTimeout();
  const acknowledgment = Promise.withResolvers<void>();
  bridge.acknowledge.mockReturnValue(acknowledgment.promise);
  receiveNotificationTap(
    {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'notification' },
      deliveryId: 'stalled-ack',
    },
    bridge.acknowledge
  );
  const intent = pendingNotificationNavigation()!;
  finishNotificationNavigation(intent);
  await vi.advanceTimersByTimeAsync(8000);
  expect(bridge.releaseCover).toHaveBeenCalledOnce();
  expect(pendingNotificationNavigation()).toBe(intent);

  acknowledgment.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(pendingNotificationNavigation()).toBeUndefined();
});

it('gives a newer tap its own deadline instead of releasing it on the previous timer', async () => {
  mountCoverTimeout();
  receiveNotificationTap(
    {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'first' },
      deliveryId: 'first',
    },
    bridge.acknowledge
  );
  await vi.advanceTimersByTimeAsync(7000);
  receiveNotificationTap(
    {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'second' },
      deliveryId: 'second',
    },
    bridge.acknowledge
  );
  const intent = pendingNotificationNavigation();
  await vi.advanceTimersByTimeAsync(1000);
  expect(bridge.releaseCover).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(7000);
  expect(bridge.releaseCover).toHaveBeenCalledOnce();
  expect(pendingNotificationNavigation()).toBe(intent);
});

it.each(['completed', 'disposed'] as const)(
  'cancels the cover deadline when the navigation is %s',
  async (outcome) => {
    const dispose = mountCoverTimeout();
    await vi.advanceTimersByTimeAsync(10_000);
    bridge.releaseCover.mockClear();
    receiveNotificationTap(
      {
        type: 'BACKGROUND_TAP',
        payload: { notificationId: 'notification' },
        deliveryId: 'tap',
      },
      bridge.acknowledge
    );
    await vi.advanceTimersByTimeAsync(1000);
    if (outcome === 'completed') {
      finishNotificationNavigation(pendingNotificationNavigation()!);
    } else {
      dispose();
    }
    await vi.advanceTimersByTimeAsync(8000);
    expect(bridge.releaseCover).not.toHaveBeenCalled();
  }
);

it('lets a tap received during startup keep its own cover deadline', async () => {
  mountCoverTimeout();
  await vi.advanceTimersByTimeAsync(7000);
  receiveNotificationTap(
    {
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'notification' },
      deliveryId: 'startup-tap',
    },
    bridge.acknowledge
  );
  const intent = pendingNotificationNavigation();
  await vi.advanceTimersByTimeAsync(1000);
  expect(bridge.releaseCover).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(7000);
  expect(bridge.releaseCover).toHaveBeenCalledOnce();
  expect(pendingNotificationNavigation()).toBe(intent);
});

it.each(['unsupported', 'legacy'] as const)(
  'does not release a cover for %s notifications',
  async (kind) => {
    bridge.supported = kind !== 'unsupported';
    mountCoverTimeout();
    await vi.advanceTimersByTimeAsync(10_000);
    bridge.releaseCover.mockClear();
    receiveNotificationTap(
      {
        type: 'BACKGROUND_TAP',
        payload: { notificationId: 'notification' },
        ...(kind === 'unsupported' ? { deliveryId: 'tap' } : {}),
      },
      bridge.acknowledge
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(bridge.releaseCover).not.toHaveBeenCalled();
  }
);

it('preserves a buffered tap when the pending snapshot stalls', async () => {
  bridge.watch.mockImplementation(
    async (receive: (event: PushEvent) => void) => {
      receive({
        type: 'BACKGROUND_TAP',
        payload: { notificationId: 'buffered-notification' },
        deliveryId: 'buffered-delivery',
      });
    }
  );
  bridge.pending.mockImplementation(() => new Promise(() => {}));
  const finished = vi.fn();
  const launch = (async () => {
    await prepareNotificationLaunch();
    finished();
  })();
  await vi.advanceTimersByTimeAsync(1500);
  expect(finished).toHaveBeenCalledOnce();
  await launch;
  expect(window.location.hash).toBe('#/');
  expect(pendingNotificationNavigation()?.notificationId).toBe(
    'buffered-notification'
  );
  expect(bridge.acknowledge).not.toHaveBeenCalled();
});

it.each(['watch', 'pending'] as const)(
  'releases the native cover when %s rejects',
  async (phase) => {
    bridge[phase].mockRejectedValue(new Error('bridge unavailable'));
    await prepareNotificationLaunch();
    expect(bridge.releaseCover).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/channels/previous-channel');
    expect(vi.getTimerCount()).toBe(0);
    expect(bridge.acknowledge).not.toHaveBeenCalled();
  }
);
