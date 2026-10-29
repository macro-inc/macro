// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMeetingSessionLifecycle } from '../primitives/meeting-session-lifecycle';
import { MeetingPage } from './meeting-page';

afterEach(cleanup);

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
            shareToken: 'share',
          }),
          release: () => released,
          connect: async () => {
            setActiveCallId('call-1');
          },
          disconnect: async () => {
            setActiveCallId(null);
          },
        }}
        renderCall={(leave) => (
          <button type="button" onClick={leave}>
            Hang up
          </button>
        )}
      />
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
      }}
      renderCall={() => <div>Connected</div>}
    />
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
