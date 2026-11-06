// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingCredentials,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import { createMeetingSessionLifecycle } from './meeting-session-lifecycle';
import { createMeetingSessionOwner } from './meeting-session-owner';

const CREDENTIALS: MeetingCredentials = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room-1',
  serverUrl: 'wss://example.com',
  token: 'scoped-rtc-token',
  participantId: 'participant-1',
  shareToken: 'meeting-link',
  started: false,
};

describe('retained meeting companion', () => {
  it('finds the detached session by call identity and leaves through its credential owner', async () => {
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const release = vi.fn(async () => ({ callEnded: false }));
    const disconnect = vi.fn(async () => {
      setActiveId(null);
    });
    const capabilities: MeetingSessionCapabilities = {
      lifecycle: createMeetingSessionLifecycle(),
      shareToken: () => 'meeting-link',
      isInCall: () => activeId() !== null,
      activeCallId: activeId,
      join: async () => CREDENTIALS,
      release,
      connect: async () => {
        setActiveId(CREDENTIALS.callId);
      },
      disconnect,
    };
    let dispose!: () => void;
    const owner = createRoot((cleanup) => {
      dispose = cleanup;
      return createMeetingSessionOwner();
    });
    const owned = owner.acquire(capabilities);
    await owned.session.join(undefined, {
      microphoneEnabled: false,
      cameraEnabled: false,
    });
    owned.detach();
    expect(owner.forCall('another-call')).toBeUndefined();
    expect(owner.forCall('call-1')?.shareToken).toBe('meeting-link');
    await owner.forCall('call-1')?.leave();
    expect(release).toHaveBeenCalledExactlyOnceWith(
      'meeting-link',
      'scoped-rtc-token'
    );
    expect(disconnect).toHaveBeenCalledOnce();
    expect(owner.forCall('call-1')).toBeUndefined();
    dispose();
  });
});
