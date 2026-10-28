// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingCredentials,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import { createMeetingSessionLifecycle } from './meeting-session-lifecycle';
import { createMeetingSessionOwner } from './meeting-session-owner';

const credentials: MeetingCredentials = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room-1',
  serverUrl: 'wss://example.com',
  token: 'rtc-token',
  participantId: 'participant-1',
  shareToken: 'meeting-1',
};
const preferences = { microphoneEnabled: false, cameraEnabled: false };

describe('provider-owned meeting sessions', () => {
  it('keeps a connected session on route dismissal and reuses it for the same token', async () => {
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [shareToken, setShareToken] = createSignal('');
    const join = vi.fn(async () => credentials);
    const release = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => {
      setActiveId(null);
    });
    const capabilities: MeetingSessionCapabilities = {
      lifecycle: createMeetingSessionLifecycle(),
      shareToken,
      isInCall: () => activeId() !== null,
      activeCallId: activeId,
      join,
      release,
      connect: async () => {
        setActiveId('call-1');
      },
      disconnect,
    };
    let dispose!: () => void;
    const owner = createRoot((cleanup) => {
      dispose = cleanup;
      return createMeetingSessionOwner();
    });
    const first = owner.acquire(capabilities);
    setShareToken('meeting-1');
    await first.session.join('Guest', preferences);
    first.detach();
    expect(release).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    const reopened = owner.acquire({
      ...capabilities,
      shareToken: () => 'meeting-1',
    });
    expect(reopened.session).toBe(first.session);
    expect(reopened.session.joinedName()).toBe('Guest');
    expect(join).toHaveBeenCalledOnce();
    reopened.detach();
    setActiveId(null);
    expect(release).toHaveBeenCalledOnce();
    const afterDisconnect = owner.acquire(capabilities);
    expect(afterDisconnect.session).not.toBe(first.session);
    afterDisconnect.detach();
    dispose();
  });

  it('cancels a pending join on dismissal and holds cleanup before another owner joins', async () => {
    let resolveToken!: (value: MeetingCredentials) => void;
    const tokenRequest = new Promise<MeetingCredentials>((resolve) => {
      resolveToken = resolve;
    });
    const lifecycle = createMeetingSessionLifecycle();
    let joined!: () => void;
    const requested = new Promise<void>((resolve) => {
      joined = resolve;
    });
    const firstJoin = vi.fn(() => {
      joined();
      return tokenRequest;
    });
    const secondJoin = vi.fn(async () => credentials);
    const release = vi.fn(async () => undefined);
    const capabilities: MeetingSessionCapabilities = {
      lifecycle,
      shareToken: () => 'meeting-1',
      isInCall: () => false,
      activeCallId: () => null,
      join: firstJoin,
      release,
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
    let dispose!: () => void;
    const owner = createRoot((cleanup) => {
      dispose = cleanup;
      return createMeetingSessionOwner();
    });
    const first = owner.acquire(capabilities);
    const joining = first.session.join(undefined, preferences);
    await requested;
    expect(firstJoin).toHaveBeenCalledOnce();
    first.detach();
    const next = owner.acquire({ ...capabilities, join: secondJoin });
    const retry = next.session.join(undefined, preferences);
    await Promise.resolve();
    expect(secondJoin).not.toHaveBeenCalled();
    resolveToken(credentials);
    await joining;
    await retry;
    expect(release).toHaveBeenCalledExactlyOnceWith('meeting-1', 'rtc-token');
    expect(capabilities.connect).toHaveBeenCalledOnce();
    expect(secondJoin).toHaveBeenCalledOnce();
    next.detach();
    dispose();
  });

  it('releases connected sessions when the provider unmounts', async () => {
    const release = vi.fn(async () => undefined);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const disconnect = vi.fn(async () => {
      setActiveId(null);
    });
    const capabilities: MeetingSessionCapabilities = {
      lifecycle: createMeetingSessionLifecycle(),
      shareToken: () => 'meeting-1',
      isInCall: () => activeId() !== null,
      activeCallId: activeId,
      join: async () => credentials,
      release,
      connect: async () => {
        setActiveId('call-1');
      },
      disconnect,
    };
    let dispose!: () => void;
    const owner = createRoot((cleanup) => {
      dispose = cleanup;
      return createMeetingSessionOwner();
    });
    const view = owner.acquire(capabilities);
    await view.session.join(undefined, preferences);
    view.detach();
    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledExactlyOnceWith('meeting-1', 'rtc-token');
  });
});
