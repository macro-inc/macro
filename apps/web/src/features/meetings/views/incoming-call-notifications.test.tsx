/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IncomingMeetingInvitationsContext } from '../context/incoming-meeting-invitations';
import type { MeetingInvitation } from '../core/meeting-invitations';
import { createIncomingMeetingInvitations } from '../primitives/incoming-meeting-invitations';
import { IncomingCallNotifications } from './incoming-call-notifications';

const NOW = new Date('2026-09-24T17:00:00Z').getTime();
const invitation: MeetingInvitation = {
  meetingId: 'meeting-countdown',
  shareToken: 'meeting-token',
  title: 'Planning',
  createdBy: 'macro|caller@example.com',
  invitedAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 30_000).toISOString(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(event = invitation) {
  let incoming!: ReturnType<typeof createIncomingMeetingInvitations>;
  let resolveName!: (name: string) => void;
  const stop = vi.fn();
  render(() => {
    incoming = createIncomingMeetingInvitations({
      userId: () => 'macro|recipient@example.com',
      callerName: () =>
        new Promise((resolve) => {
          resolveName = resolve;
        }),
      ring: () => stop,
      notify: async () => undefined,
      publishResolution: () => {},
      openMeeting: () => {},
    });
    return (
      <IncomingMeetingInvitationsContext.Provider value={incoming}>
        <IncomingCallNotifications />
      </IncomingMeetingInvitationsContext.Provider>
    );
  });
  incoming.receive(event);
  return { incoming, stop, resolveName: (name: string) => resolveName(name) };
}

function remaining() {
  return Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));
}

it('counts down to dismissal without restarting when the caller name resolves', async () => {
  const state = setup();
  expect(remaining()).toBe(30);
  const join = screen.getByRole('button', { name: 'Join Planning call' });
  join.focus();
  vi.advanceTimersByTime(15_000);
  expect(remaining()).toBe(15);

  state.resolveName('Ada');
  await Promise.resolve();
  expect(screen.getByText('Ada is calling you')).toBeTruthy();
  expect(document.activeElement).toBe(join);
  expect(remaining()).toBe(15);

  vi.advanceTimersByTime(14_000);
  expect(remaining()).toBe(1);
  vi.advanceTimersByTime(1000);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(state.stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('starts at the remaining server lifetime for a delayed invitation', () => {
  vi.setSystemTime(NOW + 25_000);
  setup();
  expect(remaining()).toBe(5);
  vi.advanceTimersByTime(5000);
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
});

it('caps long deadlines at 30 seconds and resets for a newer invitation', () => {
  const { incoming } = setup({
    ...invitation,
    expiresAt: new Date(NOW + 60_000).toISOString(),
  });
  expect(remaining()).toBe(30);
  vi.advanceTimersByTime(20_000);
  expect(remaining()).toBe(10);
  incoming.receive({
    ...invitation,
    invitedAt: new Date(NOW + 20_000).toISOString(),
    expiresAt: new Date(NOW + 50_000).toISOString(),
  });
  expect(remaining()).toBe(30);
  fireEvent.click(
    screen.getByRole('button', { name: 'Decline Planning call' })
  );
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
