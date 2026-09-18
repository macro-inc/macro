// @vitest-environment jsdom
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingCredentials,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import { createMeetingSession } from './meeting-session';

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
    let resolve!: (token: MeetingCredentials) => void;
    const response = new Promise<MeetingCredentials>((done) => {
      resolve = done;
    });
    const { session, capabilities, dispose } = setup({
      join: vi.fn(() => response),
    });
    const joining = session.join('Taylor', preferences);
    await vi.waitFor(() => expect(capabilities.join).toHaveBeenCalledOnce());
    dispose();
    resolve(token);
    await joining;
    expect(capabilities.connect).not.toHaveBeenCalled();
    expect(capabilities.release).toHaveBeenCalledWith(
      'meeting-secret',
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

  it('does not replace an existing call', async () => {
    const { session, capabilities, dispose } = setup({ isInCall: () => true });
    await session.join('Taylor', preferences);
    expect(capabilities.join).not.toHaveBeenCalled();
    expect(session.error()).toContain('Leave your current call');
    dispose();
  });
});
