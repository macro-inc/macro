import type { PlatformNotificationState } from '@app/features/notifications/components/PlatformNotificationProvider';
import { DefaultUserNameResolver } from '@notifications/notification-resolvers';
import { setActiveCallStartedCache } from '@queries/call/call';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CallStartedNotifier,
  startCallRinger,
  stopCallRinger,
} from '../CallStartedNotifier';
import { createCallEventsEffect } from '../call-events';
import { publishCallResolution } from '../call-resolution';

const platform = vi.hoisted(() => ({
  showNotification: vi
    .fn<PlatformNotificationState['showNotification']>()
    .mockResolvedValue('not-granted'),
}));

vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/context/channels', () => ({
  useChannelDirectory: () => ({ lookup: () => ({ status: 'missing' }) }),
  loadedChannel: () => undefined,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'local-user' }));
vi.mock('@notifications', () => ({
  usePlatformNotificationState: () => ({
    permission: () => 'granted',
    requestPermission: async () => 'granted',
    unregisterNotification: async () => undefined,
    showNotification: platform.showNotification,
  }),
}));
vi.mock('@notifications/notification-resolvers', () => ({
  DefaultUserNameResolver: vi.fn(),
}));
vi.mock('@queries/call/call', () => ({
  invalidateActiveCallQueries: vi.fn(),
  setActiveCallEndedCache: vi.fn(),
  setActiveCallStartedCache: vi.fn(),
}));
vi.mock('@queries/messages/timeline', () => ({
  invalidateMessageTimeline: vi.fn(),
}));
vi.mock('../CallContext', () => ({
  useCallContext: () => ({ activeCallId: () => null }),
}));
vi.mock('../call-events', () => ({ createCallEventsEffect: vi.fn() }));
vi.mock('../join-channel-call', () => ({ joinChannelCall: vi.fn() }));

const contexts: TestAudioContext[] = [];
const disposals: (() => void)[] = [];
let callNumber = 0;

class TestAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  close = vi.fn(async () => undefined);

  constructor() {
    contexts.push(this);
  }

  createGain() {
    return {
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    };
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('AudioContext', TestAudioContext);
  contexts.length = 0;
  callNumber += 1;
});

afterEach(() => {
  stopCallRinger(`call-${callNumber}`);
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('incoming call sound lifecycle', () => {
  it('does not restart the sound or extend the deadline for duplicate starts', async () => {
    const callId = `call-${callNumber}`;
    startCallRinger(callId, () => false);
    expect(contexts).toHaveLength(1);

    for (let duplicate = 0; duplicate < 10; duplicate += 1) {
      startCallRinger(callId, () => false);
    }
    expect(contexts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(29_000);
    startCallRinger(callId, () => false);
    const soundsBeforeDeadline = contexts.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(contexts).toHaveLength(soundsBeforeDeadline);
    expect(
      contexts.every((context) => context.close.mock.calls.length > 0)
    ).toBe(true);

    // Expiry is terminal too: a delayed start cannot open another ring window.
    startCallRinger(callId, () => false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(contexts).toHaveLength(soundsBeforeDeadline);
  });

  it.each(['answered', 'declined', 'ended'] as const)(
    'keeps a %s call silent when a delayed start arrives',
    async (type) => {
      const callId = `call-${callNumber}`;
      disposals.push(
        createRoot((dispose) => {
          CallStartedNotifier();
          return dispose;
        })
      );
      startCallRinger(callId, () => false);
      expect(contexts).toHaveLength(1);

      if (type === 'answered') {
        publishCallResolution({ type, callId, answeredBy: 'local-user' });
      } else if (type === 'declined') {
        publishCallResolution({ type, callId, declinedBy: 'local-user' });
      } else {
        publishCallResolution({ type, callId, channelId: 'channel-1' });
      }
      expect(contexts[0].close).toHaveBeenCalledOnce();

      // This tab is not joined when another device answers. A stale start
      // must not undo the terminal resolution or acquire another sound.
      startCallRinger(callId, () => false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(contexts).toHaveLength(1);
    }
  );

  it.each(['answered', 'declined', 'ended'] as const)(
    'does not create a system notification for a start after %s',
    async (type) => {
      const callId = `call-${callNumber}`;
      disposals.push(
        createRoot((dispose) => {
          CallStartedNotifier();
          return dispose;
        })
      );
      if (type === 'answered') {
        publishCallResolution({ type, callId, answeredBy: 'local-user' });
      } else if (type === 'declined') {
        publishCallResolution({ type, callId, declinedBy: 'local-user' });
      } else {
        publishCallResolution({ type, callId, channelId: 'channel-1' });
        publishCallResolution({
          type: 'answered',
          callId,
          answeredBy: 'local-user',
        });
      }
      const handlers = vi.mocked(createCallEventsEffect).mock.calls[0][0];
      handlers.onCallStarted?.({
        callId,
        channelId: 'channel-1',
        createdBy: null,
        isFromSelf: false,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(platform.showNotification).not.toHaveBeenCalled();
      expect(contexts).toHaveLength(0);
      expect(setActiveCallStartedCache).toHaveBeenCalledTimes(
        type === 'ended' ? 0 : 1
      );
    }
  );

  it('does not show a delayed notification when resolution arrives during name lookup', async () => {
    const callId = `call-${callNumber}`;
    let finishName!: (name: string) => void;
    vi.mocked(DefaultUserNameResolver).mockReturnValueOnce(
      new Promise((resolve) => {
        finishName = resolve;
      })
    );
    disposals.push(
      createRoot((dispose) => {
        CallStartedNotifier();
        return dispose;
      })
    );
    const handlers = vi.mocked(createCallEventsEffect).mock.calls[0][0];
    handlers.onCallStarted?.({
      callId,
      channelId: 'channel-1',
      createdBy: 'remote-user',
      isFromSelf: false,
    });
    publishCallResolution({
      type: 'answered',
      callId,
      answeredBy: 'local-user',
    });
    finishName('Caller');
    await vi.advanceTimersByTimeAsync(0);
    expect(platform.showNotification).not.toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('still notifies when a different participant answers the active call', async () => {
    const callId = `call-${callNumber}`;
    disposals.push(
      createRoot((dispose) => {
        CallStartedNotifier();
        return dispose;
      })
    );
    publishCallResolution({
      type: 'answered',
      callId,
      answeredBy: 'another-user',
    });
    const handlers = vi.mocked(createCallEventsEffect).mock.calls[0][0];
    handlers.onCallStarted?.({
      callId,
      channelId: 'channel-1',
      createdBy: null,
      isFromSelf: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(platform.showNotification).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(1);
    expect(setActiveCallStartedCache).toHaveBeenCalledOnce();
  });
});
