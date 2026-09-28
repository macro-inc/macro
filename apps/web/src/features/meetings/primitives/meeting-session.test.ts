// @vitest-environment jsdom
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingCredentials,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import { fakeTrack } from '../tests/fake-media';
import { createMeetingSession } from './meeting-session';
import { createMeetingSessionLifecycle } from './meeting-session-lifecycle';

const token: MeetingCredentials = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room-1',
  serverUrl: 'wss://example.com',
  token: 'scoped-rtc-token',
  participantId: 'guest-1',
  shareToken: 'meeting-secret',
};
const preferences = { microphoneEnabled: false, cameraEnabled: false };

function setup(overrides: Partial<MeetingSessionCapabilities> = {}) {
  let activeCallId: string | null = null;
  const capabilities: MeetingSessionCapabilities = {
    lifecycle: createMeetingSessionLifecycle(),
    shareToken: () => 'meeting-secret',
    isInCall: () => activeCallId !== null,
    activeCallId: () => activeCallId,
    join: vi.fn(async () => token),
    release: vi.fn(async () => undefined),
    connect: vi.fn(async () => {
      activeCallId = token.callId;
    }),
    disconnect: vi.fn(async () => {
      activeCallId = null;
    }),
    ...overrides,
  };
  let dispose!: () => void;
  const session = createRoot((cleanup) => {
    dispose = cleanup;
    return createMeetingSession(capabilities);
  });
  return {
    session,
    capabilities,
    dispose,
    replaceCall: (id: string | null) => {
      activeCallId = id;
    },
  };
}

describe('meeting session ownership', () => {
  it('prepares only when joining and retains the prepared invitation for release', async () => {
    let shareToken = '';
    let finishPrepare!: () => void;
    let preparationSignal: AbortSignal | undefined;
    const preparation = new Promise<void>((resolve) => {
      finishPrepare = resolve;
    });
    const { session, capabilities, dispose } = setup({
      shareToken: () => shareToken,
      prepare: vi.fn(async (signal) => {
        preparationSignal = signal;
        await preparation;
        shareToken = 'prepared-meeting';
      }),
    });
    expect(capabilities.prepare).not.toHaveBeenCalled();
    const joining = session.join(undefined, preferences);
    await vi.waitFor(() => expect(capabilities.prepare).toHaveBeenCalledOnce());
    expect(session.joining()).toBe(true);
    expect(capabilities.join).not.toHaveBeenCalled();
    await session.join(undefined, preferences);
    expect(capabilities.prepare).toHaveBeenCalledOnce();
    finishPrepare();
    await joining;
    expect(capabilities.join).toHaveBeenCalledOnce();
    expect(capabilities.connect).toHaveBeenCalledWith(token, preferences);
    expect(preparationSignal?.aborted).toBe(false);
    shareToken = 'another-meeting';
    await session.leave();
    expect(preparationSignal?.aborted).toBe(true);
    expect(capabilities.release).toHaveBeenCalledExactlyOnceWith(
      'prepared-meeting',
      token.token
    );
    dispose();
  });

  it.each(['cancel', 'dispose'] as const)(
    'aborts preparation on %s and ignores a late-created meeting',
    async (action) => {
      let finishPrepare!: () => void;
      let preparationSignal: AbortSignal | undefined;
      const preparation = new Promise<void>((resolve) => {
        finishPrepare = resolve;
      });
      const { session, capabilities, dispose } = setup({
        prepare: vi.fn(async (signal) => {
          preparationSignal = signal;
          await preparation;
        }),
      });
      const localTracks = {
        microphone: fakeTrack('audio'),
        camera: fakeTrack('video'),
      };
      const joining = session.join(undefined, { ...preferences, localTracks });
      await vi.waitFor(() =>
        expect(capabilities.prepare).toHaveBeenCalledOnce()
      );
      if (action === 'cancel') await session.leave();
      else dispose();
      expect(preparationSignal?.aborted).toBe(true);
      finishPrepare();
      await joining;
      expect(capabilities.join).not.toHaveBeenCalled();
      expect(capabilities.connect).not.toHaveBeenCalled();
      expect(capabilities.release).not.toHaveBeenCalled();
      expect(session.error()).toBeUndefined();
      expect(localTracks.microphone.stop).toHaveBeenCalledOnce();
      expect(localTracks.camera.stop).toHaveBeenCalledOnce();
      dispose();
    }
  );

  it('waits for cancelled preparation before retrying with a fresh signal', async () => {
    let finishFirst!: () => void;
    const firstPreparation = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const signals: AbortSignal[] = [];
    let shareToken = '';
    const { session, capabilities, dispose } = setup({
      shareToken: () => shareToken,
      prepare: vi.fn(async (signal) => {
        signals.push(signal);
        if (signals.length === 1) {
          await firstPreparation;
          shareToken = 'cancelled-meeting';
        } else {
          shareToken = 'retry-meeting';
        }
      }),
    });
    const firstJoin = session.join(undefined, preferences);
    await vi.waitFor(() => expect(capabilities.prepare).toHaveBeenCalledOnce());
    await session.leave();
    const retry = session.join(undefined, preferences);
    await Promise.resolve();
    expect(capabilities.prepare).toHaveBeenCalledOnce();
    expect(signals[0]?.aborted).toBe(true);
    finishFirst();
    await firstJoin;
    await retry;
    expect(signals[1]?.aborted).toBe(false);
    expect(capabilities.join).toHaveBeenCalledOnce();
    expect(capabilities.connect).toHaveBeenCalledOnce();
    expect(session.joinedCallId()).toBe(token.callId);
    await session.leave();
    expect(capabilities.release).toHaveBeenCalledExactlyOnceWith(
      'retry-meeting',
      token.token
    );
    dispose();
  });

  it('allows retry after preparation fails without issuing a participant', async () => {
    const prepare = vi
      .fn<NonNullable<MeetingSessionCapabilities['prepare']>>()
      .mockRejectedValueOnce(new Error('creation failed'))
      .mockResolvedValue(undefined);
    const { session, capabilities, dispose } = setup({ prepare });
    await session.join(undefined, preferences);
    expect(capabilities.join).not.toHaveBeenCalled();
    expect(capabilities.release).not.toHaveBeenCalled();
    expect(session.joining()).toBe(false);
    expect(session.error()).toContain('Could not join');
    await session.join(undefined, preferences);
    expect(capabilities.join).toHaveBeenCalledOnce();
    expect(session.joinedCallId()).toBe(token.callId);
    expect(session.error()).toBeUndefined();
    dispose();
  });

  it('validates guest names before requesting a token and respects media preferences', async () => {
    const { session, capabilities, dispose } = setup();
    await session.join('  ', preferences);
    expect(capabilities.join).not.toHaveBeenCalled();
    expect(session.error()).toContain('Enter your name');
    await session.join('  Taylor  ', preferences);
    expect(capabilities.join).toHaveBeenCalledWith('Taylor');
    expect(capabilities.connect).toHaveBeenCalledWith(token, preferences);
    expect(session.joinedCallId()).toBe(token.callId);
    dispose();
  });

  it('releases a late token after the page is closed without opening media', async () => {
    let shareToken = '';
    let resolve!: (token: MeetingCredentials) => void;
    const response = new Promise<MeetingCredentials>((done) => {
      resolve = done;
    });
    const { session, capabilities, dispose } = setup({
      shareToken: () => shareToken,
      prepare: async () => {
        shareToken = 'prepared-meeting';
      },
      join: vi.fn(() => response),
    });
    const joining = session.join('Taylor', preferences);
    await vi.waitFor(() => expect(capabilities.join).toHaveBeenCalledOnce());
    dispose();
    shareToken = 'another-meeting';
    resolve(token);
    await joining;
    expect(capabilities.connect).not.toHaveBeenCalled();
    expect(capabilities.release).toHaveBeenCalledWith(
      'prepared-meeting',
      token.token
    );
  });

  it('releases a token when media connection fails so a retry can join', async () => {
    const { session, capabilities, dispose } = setup({
      connect: vi.fn(async () => {
        throw new Error('connection failed');
      }),
    });
    await session.join(undefined, preferences);
    expect(capabilities.release).toHaveBeenCalledWith(
      'meeting-secret',
      token.token
    );
    expect(session.joining()).toBe(false);
    expect(session.error()).toContain('Could not join');
    expect(session.joinedCallId()).toBeUndefined();
    dispose();
  });

  it('releases only once when cancellation interrupts a failing connection', async () => {
    let rejectConnect!: (error: Error) => void;
    const connection = new Promise<void>((_, reject) => {
      rejectConnect = reject;
    });
    const { session, capabilities, dispose } = setup({
      connect: vi.fn(() => connection),
    });
    const joining = session.join('Taylor', preferences);
    await vi.waitFor(() => expect(capabilities.connect).toHaveBeenCalledOnce());
    await session.leave();
    rejectConnect(new Error('cancelled'));
    await joining;
    expect(capabilities.release).toHaveBeenCalledOnce();
    dispose();
  });

  it('finishes cancelled token cleanup before retrying the same authenticated identity', async () => {
    let resolveFirst!: (token: MeetingCredentials) => void;
    const firstToken = new Promise<MeetingCredentials>((resolve) => {
      resolveFirst = resolve;
    });
    const requests = vi
      .fn()
      .mockReturnValueOnce(firstToken)
      .mockResolvedValue(token);
    const { session, capabilities, dispose } = setup({ join: requests });
    const firstJoin = session.join(undefined, preferences);
    await vi.waitFor(() => expect(requests).toHaveBeenCalledOnce());
    await session.leave();
    const retry = session.join(undefined, preferences);
    await Promise.resolve();
    expect(requests).toHaveBeenCalledOnce();
    resolveFirst(token);
    await firstJoin;
    await retry;
    expect(capabilities.release).toHaveBeenCalledOnce();
    expect(capabilities.connect).toHaveBeenCalledOnce();
    expect(requests).toHaveBeenCalledTimes(2);
    expect(session.joinedCallId()).toBe(token.callId);
    dispose();
  });

  it('waits for hangup cleanup before rejoining with the same identity', async () => {
    let finishRelease!: () => void;
    const releasePending = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const { session, capabilities, dispose } = setup({
      release: vi.fn(() => releasePending),
    });
    await session.join(undefined, preferences);
    const leaving = session.leave();
    await vi.waitFor(() => expect(capabilities.release).toHaveBeenCalledOnce());
    const retry = session.join(undefined, preferences);
    await Promise.resolve();
    expect(capabilities.join).toHaveBeenCalledOnce();
    finishRelease();
    await leaving;
    await retry;
    expect(capabilities.join).toHaveBeenCalledTimes(2);
    expect(session.joinedCallId()).toBe(token.callId);
    dispose();
  });

  it('holds a new owner until a disposed owner releases its late token', async () => {
    const lifecycle = createMeetingSessionLifecycle();
    let resolveToken!: (credentials: MeetingCredentials) => void;
    const pendingToken = new Promise<MeetingCredentials>((resolve) => {
      resolveToken = resolve;
    });
    let finishRelease!: () => void;
    const pendingRelease = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const oldOwner = setup({
      lifecycle,
      join: vi.fn(() => pendingToken),
      release: vi.fn(() => pendingRelease),
    });
    const oldJoin = oldOwner.session.join(undefined, preferences);
    await vi.waitFor(() =>
      expect(oldOwner.capabilities.join).toHaveBeenCalledOnce()
    );
    oldOwner.dispose();

    const newOwner = setup({ lifecycle });
    const newJoin = newOwner.session.join(undefined, preferences);
    await Promise.resolve();
    expect(newOwner.session.joining()).toBe(true);
    expect(newOwner.capabilities.join).not.toHaveBeenCalled();

    resolveToken(token);
    await vi.waitFor(() =>
      expect(oldOwner.capabilities.release).toHaveBeenCalledExactlyOnceWith(
        'meeting-secret',
        token.token
      )
    );
    expect(oldOwner.capabilities.connect).not.toHaveBeenCalled();
    expect(newOwner.capabilities.join).not.toHaveBeenCalled();

    finishRelease();
    await oldJoin;
    await newJoin;
    expect(newOwner.capabilities.join).toHaveBeenCalledOnce();
    expect(newOwner.session.joinedCallId()).toBe(token.callId);
    newOwner.dispose();
  });

  it('does not issue credentials for an owner cancelled while earlier cleanup is pending', async () => {
    const lifecycle = createMeetingSessionLifecycle();
    const cleanup = lifecycle.begin();
    const { session, capabilities, dispose } = setup({ lifecycle });
    const localTracks = { microphone: fakeTrack('audio') };
    const joining = session.join(undefined, { ...preferences, localTracks });
    dispose();
    cleanup.complete();
    await joining;
    expect(capabilities.join).not.toHaveBeenCalled();
    expect(capabilities.connect).not.toHaveBeenCalled();
    expect(localTracks.microphone.stop).toHaveBeenCalledOnce();
  });

  it('releases disconnected credentials when a queued rejoin is immediately cancelled', async () => {
    const { session, capabilities, replaceCall, dispose } = setup();
    await session.join(undefined, preferences);
    replaceCall(null);
    const retry = session.join(undefined, preferences);
    dispose();
    await retry;
    expect(capabilities.join).toHaveBeenCalledOnce();
    expect(capabilities.release).toHaveBeenCalledExactlyOnceWith(
      'meeting-secret',
      token.token
    );
  });

  it('does not disconnect a newer call when this page is cleaned up', async () => {
    const { session, capabilities, replaceCall, dispose } = setup();
    await session.join('Taylor', preferences);
    replaceCall('newer-call');
    await session.leave();
    expect(capabilities.disconnect).not.toHaveBeenCalled();
    expect(capabilities.release).toHaveBeenCalledWith(
      'meeting-secret',
      token.token
    );
    dispose();
  });

  it('passes waiting-room tracks to the connection that uses them', async () => {
    const { session, capabilities, dispose } = setup();
    const localTracks = { microphone: fakeTrack('audio') };
    await session.join('Taylor', { ...preferences, localTracks });
    expect(capabilities.connect).toHaveBeenCalledWith(token, {
      ...preferences,
      localTracks,
    });
    expect(localTracks.microphone.stop).not.toHaveBeenCalled();
    dispose();
  });

  it.each([
    ['the join is rejected', { isInCall: () => true }],
    [
      'preparation fails',
      {
        prepare: vi.fn(async () => {
          throw new Error('creation failed');
        }),
      },
    ],
    [
      'the token request fails',
      {
        join: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
    ],
  ] as const)(
    'stops waiting-room tracks when %s before connecting',
    async (_, overrides) => {
      const { session, capabilities, dispose } = setup(overrides);
      const localTracks = {
        microphone: fakeTrack('audio'),
        camera: fakeTrack('video'),
      };
      await session.join('Taylor', { ...preferences, localTracks });
      expect(capabilities.connect).not.toHaveBeenCalled();
      expect(localTracks.microphone.stop).toHaveBeenCalledOnce();
      expect(localTracks.camera.stop).toHaveBeenCalledOnce();
      dispose();
    }
  );

  it('does not replace an existing call', async () => {
    const { session, capabilities, dispose } = setup({
      isInCall: () => true,
      prepare: vi.fn(async () => undefined),
    });
    await session.join('Taylor', preferences);
    expect(capabilities.prepare).not.toHaveBeenCalled();
    expect(capabilities.join).not.toHaveBeenCalled();
    expect(session.error()).toContain('Leave your current call');
    dispose();
  });

  it('retains its current session when Join is called while already connected', async () => {
    const { session, capabilities, dispose } = setup();
    await session.join(undefined, preferences);
    await session.join(undefined, preferences);
    expect(capabilities.join).toHaveBeenCalledOnce();
    expect(capabilities.release).not.toHaveBeenCalled();
    expect(session.joinedCallId()).toBe(token.callId);
    expect(session.error()).toContain('Leave your current call');
    await session.leave();
    expect(capabilities.release).toHaveBeenCalledOnce();
    dispose();
  });
});
