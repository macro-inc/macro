// @vitest-environment jsdom

import type { CallMediaPath } from '@channel/Call/CallSessionController';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MeetingSessionProvider } from '../meeting-session-provider';
import { createMeetingSessionLifecycle } from '../primitives/meeting-session-lifecycle';
import { fakeMediaAccess, stubMediaStream } from '../tests/fake-media';
import { MeetingPage } from './meeting-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  {
    authenticated: true,
    channelId: 'channel-1',
    scheduledStart: null,
    callEnded: true,
    path: '/calls/call/call-1',
  },
  {
    authenticated: true,
    channelId: 'channel-1',
    scheduledStart: null,
    callEnded: false,
    path: '/channel/channel-1',
  },
  {
    authenticated: true,
    channelId: null,
    scheduledStart: '2026-10-19T18:00:00Z',
    callEnded: false,
    path: '/component/calendar',
  },
  {
    authenticated: true,
    channelId: null,
    scheduledStart: '2026-10-19T18:00:00Z',
    callEnded: true,
    path: '/calls/call/call-1',
  },
  {
    authenticated: true,
    channelId: null,
    scheduledStart: null,
    callEnded: false,
    path: '/calls',
  },
  {
    authenticated: true,
    channelId: null,
    scheduledStart: null,
    callEnded: true,
    path: '/calls/call/call-1',
  },
  {
    authenticated: false,
    channelId: null,
    scheduledStart: null,
    callEnded: true,
    path: '/',
  },
])(
  'leaves for $path (ended=$callEnded, member=$authenticated)',
  async (test) => {
    const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
    let finishRelease!: (value: { callEnded: boolean }) => void;
    const released = new Promise<{ callEnded: boolean }>((resolve) => {
      finishRelease = resolve;
    });
    const onLeave = vi.fn();
    const onCallStateChange = vi.fn();
    render(() => (
      <MeetingSessionProvider>
        <MeetingPage
          source={() => ({
            kind: 'ready',
            title: 'Call',
            channelId: test.channelId,
            scheduledStart: test.scheduledStart,
            scheduledEnd: null,
          })}
          authenticated={() => test.authenticated}
          author={() => 'Member'}
          onCopy={async () => {}}
          onLeave={onLeave}
          onCallStateChange={onCallStateChange}
          mediaAccess={{
            request: async () => {
              throw new DOMException('Denied', 'NotAllowedError');
            },
          }}
          session={{
            lifecycle: createMeetingSessionLifecycle(),
            shareToken: () => 'token',
            isInCall: () => activeCallId() !== null,
            activeCallId,
            join: async () => ({
              callId: 'call-1',
              channelId: test.channelId,
              roomName: 'room',
              serverUrl: 'wss://example.com',
              token: 'token',
              participantId: 'member',
              started: false,
              shareToken: 'share',
            }),
            release: () => released,
            connect: async () => {
              setActiveCallId('call-1');
            },
            disconnect: async () => {
              setActiveCallId(null);
            },
            mediaPath: () => 'browser',
          }}
          renderCall={(leave) => (
            <button type="button" onClick={leave}>
              Hang up
            </button>
          )}
        />
      </MeetingSessionProvider>
    ));
    if (!test.authenticated)
      fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), {
        target: { value: 'Guest' },
      });
    const joinButton = screen.getByRole('button', { name: 'Join call' });
    await screen.findByText('Camera unavailable');
    await waitFor(() =>
      expect(joinButton.hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(joinButton);
    await screen.findByRole('button', { name: 'Hang up' });
    onCallStateChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
    expect(activeCallId()).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Leaving call…');
    expect(onLeave).not.toHaveBeenCalled();
    expect(onCallStateChange).not.toHaveBeenCalled();
    finishRelease({ callEnded: test.callEnded });
    await waitFor(() =>
      expect(onLeave).toHaveBeenCalledExactlyOnceWith(test.path)
    );
  }
);

it('waits for confirmed membership before rendering setup or requesting devices', async () => {
  const [authenticated, setAuthenticated] = createSignal<boolean>();
  const request = vi.fn(async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  });
  const warmup = vi.fn(async () => {});
  const join = vi.fn(async () => {
    throw new Error('Must not join automatically');
  });
  render(() => (
    <MeetingSessionProvider>
      <MeetingPage
        source={() => ({
          kind: 'ready',
          title: 'Channel call',
          channelId: 'channel-1',
          scheduledStart: null,
          scheduledEnd: null,
        })}
        authenticated={authenticated}
        author={() => 'Member'}
        onCopy={async () => {}}
        mediaAccess={{ request }}
        session={{
          lifecycle: createMeetingSessionLifecycle(),
          warmup,
          shareToken: () => 'token',
          isInCall: () => false,
          activeCallId: () => null,
          join,
          release: async () => {},
          connect: async () => {},
          disconnect: async () => {},
          mediaPath: () => 'browser',
        }}
        renderCall={() => <div>Connected</div>}
      />
    </MeetingSessionProvider>
  ));
  expect(screen.queryByRole('textbox', { name: 'Your name' })).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(warmup).not.toHaveBeenCalled();
  setAuthenticated(false);
  expect(request).not.toHaveBeenCalled();
  expect(warmup).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  setAuthenticated(true);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Join call' })).toBeTruthy();
  expect(join).not.toHaveBeenCalled();
  expect(warmup).toHaveBeenCalledOnce();
});

it('treats a hang-up on the native call screen as Leave', async () => {
  const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
  const endedWatchers = new Set<(callId: string) => void>();
  const release = vi.fn(async () => ({ callEnded: false }));
  const disconnect = vi.fn(async () => {
    setActiveCallId(null);
  });
  const onLeave = vi.fn();
  render(() => (
    <MeetingSessionProvider>
      <MeetingPage
        source={() => ({
          kind: 'ready',
          title: 'Quick Call',
          channelId: null,
          scheduledStart: null,
          scheduledEnd: null,
        })}
        authenticated={() => true}
        author={() => 'Member'}
        onCopy={async () => {}}
        onLeave={onLeave}
        mediaAccess={{
          request: async () => {
            throw new DOMException('Denied', 'NotAllowedError');
          },
        }}
        session={{
          lifecycle: createMeetingSessionLifecycle(),
          shareToken: () => 'token',
          isInCall: () => activeCallId() !== null,
          activeCallId,
          join: async () => ({
            callId: 'call-1',
            channelId: null,
            roomName: 'room',
            serverUrl: 'wss://example.com',
            token: 'token',
            participantId: 'member',
            started: false,
            shareToken: 'share',
          }),
          release,
          connect: async () => {
            setActiveCallId('call-1');
          },
          disconnect,
          mediaPath: () => 'native',
          watchNativeCallEnded: (onEnded) => {
            endedWatchers.add(onEnded);
            return () => endedWatchers.delete(onEnded);
          },
        }}
        renderCall={() => <p>In the native call</p>}
      />
    </MeetingSessionProvider>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
  await screen.findByText('In the native call');

  // Native drops the call before telling JS it was ended there.
  setActiveCallId(null);
  for (const onEnded of [...endedWatchers]) onEnded('another-call');
  expect(release).not.toHaveBeenCalled();
  for (const onEnded of [...endedWatchers]) onEnded('call-1');

  await waitFor(() =>
    expect(onLeave).toHaveBeenCalledExactlyOnceWith('/calls')
  );
  expect(release).toHaveBeenCalledExactlyOnceWith('token', 'token');
  // Native already ended it; ending again could end a call that replaced it.
  expect(disconnect).toHaveBeenCalledExactlyOnceWith({ endNativeCall: false });
  expect(endedWatchers.size).toBe(0);
});

it('offers no waiting-room media choices the native call would ignore', async () => {
  const request = vi.fn(async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  });
  const connect = vi.fn(async () => {});
  render(() => (
    <MeetingSessionProvider>
      <MeetingPage
        source={() => ({
          kind: 'ready',
          title: 'Quick Call',
          channelId: null,
          scheduledStart: null,
          scheduledEnd: null,
        })}
        authenticated={() => true}
        author={() => 'Member'}
        onCopy={async () => {}}
        mediaAccess={{ request }}
        session={{
          lifecycle: createMeetingSessionLifecycle(),
          shareToken: () => 'token',
          isInCall: () => false,
          activeCallId: () => null,
          join: async () => ({
            callId: 'call-1',
            channelId: null,
            roomName: 'room',
            serverUrl: 'wss://example.com',
            token: 'token',
            participantId: 'member',
            started: false,
            shareToken: 'share',
          }),
          release: async () => {},
          connect,
          disconnect: async () => {},
          mediaPath: () => 'native',
        }}
        renderCall={() => <p>In the native call</p>}
      />
    </MeetingSessionProvider>
  ));
  await screen.findByText(/You join with your microphone on and camera off/);
  expect(
    screen.queryByRole('button', { name: 'Turn off microphone' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Turn on microphone' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: /camera/i })).toBeNull();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
  await waitFor(() => expect(connect).toHaveBeenCalledOnce());
  expect(connect).toHaveBeenCalledWith(expect.anything(), {
    microphoneEnabled: true,
    cameraEnabled: false,
  });
});

it.each([
  { case: 'known auth', authenticated: true as boolean | undefined },
  { case: 'auth that resolves late', authenticated: undefined },
])(
  'releases waiting-room capture when the media path turns native ($case)',
  async (test) => {
    stubMediaStream();
    const { request, tracks } = fakeMediaAccess();
    const [authenticated, setAuthenticated] = createSignal(test.authenticated);
    const [mediaPath, setMediaPath] = createSignal<CallMediaPath>('browser');
    render(() => (
      <MeetingSessionProvider>
        <MeetingPage
          source={() => ({
            kind: 'ready',
            title: 'Quick Call',
            channelId: null,
            scheduledStart: null,
            scheduledEnd: null,
          })}
          authenticated={authenticated}
          author={() => 'Member'}
          onCopy={async () => {}}
          mediaAccess={{ request }}
          session={{
            lifecycle: createMeetingSessionLifecycle(),
            shareToken: () => 'token',
            isInCall: () => false,
            activeCallId: () => null,
            join: async () => {
              throw new Error('Must not join');
            },
            release: async () => {},
            connect: async () => {},
            disconnect: async () => {},
            mediaPath,
          }}
          renderCall={() => <p>In the call</p>}
        />
      </MeetingSessionProvider>
    ));
    if (test.authenticated === undefined) {
      // Unknown auth may still turn out native: ask for nothing yet.
      await Promise.resolve();
      expect(request).not.toHaveBeenCalled();
      setMediaPath('native');
      setAuthenticated(true);
      await screen.findByText(/You join with your microphone on/);
      expect(request).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(request).toHaveBeenCalled());
    await waitFor(() => expect(tracks.length).toBeGreaterThan(0));
    setMediaPath('native');
    await screen.findByText(/You join with your microphone on/);
    await waitFor(() =>
      expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(
        true
      )
    );
    expect(
      screen.queryByRole('button', { name: 'Turn off microphone' })
    ).toBeNull();
  }
);
