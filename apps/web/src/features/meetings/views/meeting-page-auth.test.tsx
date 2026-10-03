// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMeetingSessionLifecycle } from '../primitives/meeting-session-lifecycle';
import { MeetingPage } from './meeting-page';

afterEach(cleanup);

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
