import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CallStartedNotifier,
  startCallRinger,
  stopCallRinger,
} from '../CallStartedNotifier';
import { publishCallResolution } from '../call-resolution';

vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/context/channels', () => ({ useChannelDirectory: () => ({}) }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'local-user' }));
vi.mock('@notifications', () => ({
  usePlatformNotificationState: () => 'not-supported',
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
});
