import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingInvitation } from '../core/meeting-invitations';
import {
  createIncomingMeetingInvitations,
  type IncomingMeetingInvitationCapabilities,
} from './incoming-meeting-invitations';

const NOW = new Date('2026-09-23T14:00:00Z');
const USER = 'macro|recipient@example.com';
const invitation: MeetingInvitation = {
  meetingId: 'meeting-1',
  shareToken: 'standalone-token',
  title: 'Planning',
  createdBy: 'macro|caller@example.com',
  invitedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
};
const disposers: (() => void)[] = [];

function setup() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [userId, setUserId] = createSignal<string | undefined>(USER);
    const closeNotification = vi.fn();
    const stopRing = vi.fn();
    const capabilities = {
      userId,
      ring: vi.fn<IncomingMeetingInvitationCapabilities['ring']>(
        () => stopRing
      ),
      callerName: vi.fn(async () => 'Ada'),
      notify: vi.fn<IncomingMeetingInvitationCapabilities['notify']>(
        async () => closeNotification
      ),
      publishResolution:
        vi.fn<IncomingMeetingInvitationCapabilities['publishResolution']>(),
      openMeeting: vi.fn(),
    };
    return {
      incoming: createIncomingMeetingInvitations(capabilities),
      capabilities,
      setUserId,
      stopRing,
      closeNotification,
      dispose,
    };
  });
}

async function settleNotification() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

describe('incoming meeting invitations', () => {
  it('rings immediately without a live session and displays the caller and title', async () => {
    const { incoming, capabilities } = setup();
    incoming.receive(invitation);
    expect(capabilities.ring).toHaveBeenCalledWith(
      expect.stringContaining(`meeting:meeting-1:${USER}:`),
      expect.any(Function),
      30_000
    );
    expect(incoming.invitations()[0]).toEqual(
      expect.objectContaining({ title: 'Planning', recipientId: USER })
    );
    await settleNotification();
    expect(incoming.invitations()[0].callerName).toBe('Ada');
    expect(capabilities.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Planning', callerName: 'Ada' }),
      expect.any(Object)
    );
  });

  it('ignores self, expired and duplicate invitations', () => {
    const { incoming, capabilities } = setup();
    incoming.receive({ ...invitation, createdBy: USER });
    incoming.receive({ ...invitation, expiresAt: NOW.toISOString() });
    expect(capabilities.ring).not.toHaveBeenCalled();
    incoming.receive(invitation);
    incoming.receive(invitation);
    expect(capabilities.ring).toHaveBeenCalledOnce();
    expect(incoming.invitations()).toHaveLength(1);
  });

  it('answers through the reusable link and resolves only this account’s matching invitation', async () => {
    const { incoming, capabilities, stopRing, closeNotification } = setup();
    incoming.receive(invitation);
    await settleNotification();
    incoming.answer(incoming.invitations()[0]);
    expect(capabilities.openMeeting).toHaveBeenCalledWith('standalone-token');
    expect(capabilities.publishResolution).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      userId: USER,
      resolvedAt: invitation.invitedAt,
    });
    expect(stopRing).toHaveBeenCalledOnce();
    expect(closeNotification).toHaveBeenCalledOnce();
    expect(incoming.invitations()).toEqual([]);
  });

  it('dismisses across tabs without a session and permits a later invitation to ring again', () => {
    const first = setup();
    const second = setup();
    first.capabilities.publishResolution.mockImplementation(
      second.incoming.resolve
    );
    first.incoming.receive(invitation);
    second.incoming.receive(invitation);
    first.incoming.dismiss(first.incoming.invitations()[0]);
    expect(first.incoming.invitations()).toEqual([]);
    expect(second.incoming.invitations()).toEqual([]);
    expect(second.stopRing).toHaveBeenCalledOnce();
    second.incoming.receive(invitation);
    expect(second.incoming.invitations()).toEqual([]);
    const later = {
      ...invitation,
      invitedAt: new Date(NOW.getTime() + 1000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 31_000).toISOString(),
    };
    second.incoming.receive(later);
    expect(second.incoming.invitations()).toHaveLength(1);
    expect(second.capabilities.ring.mock.calls[0][0]).not.toBe(
      second.capabilities.ring.mock.calls[1][0]
    );
  });

  it('ignores another user’s answer and stops when this user answers on another device', () => {
    const { incoming, stopRing } = setup();
    incoming.receive(invitation);
    incoming.answered({
      meetingId: 'meeting-1',
      userId: 'macro|other@example.com',
    });
    expect(incoming.invitations()).toHaveLength(1);
    incoming.answered({ meetingId: 'meeting-1', userId: USER });
    expect(incoming.invitations()).toEqual([]);
    expect(stopRing).toHaveBeenCalledOnce();
  });

  it('rejects cross-account resolutions and clears invitations on account change', async () => {
    const { incoming, setUserId, stopRing } = setup();
    incoming.receive(invitation);
    incoming.resolve({
      meetingId: 'meeting-1',
      userId: 'macro|other@example.com',
      resolvedAt: invitation.invitedAt,
    });
    expect(incoming.invitations()).toHaveLength(1);
    setUserId('macro|other@example.com');
    await settleNotification();
    expect(incoming.invitations()).toEqual([]);
    expect(stopRing).toHaveBeenCalledOnce();
  });

  it('expires at the server deadline and closes the notification', async () => {
    const { incoming, capabilities, stopRing, closeNotification } = setup();
    vi.setSystemTime(new Date(NOW.getTime() + 25_000));
    incoming.receive(invitation);
    await settleNotification();
    expect(capabilities.ring.mock.calls[0][2]).toBe(5000);
    vi.advanceTimersByTime(5000);
    expect(incoming.invitations()).toEqual([]);
    expect(stopRing).toHaveBeenCalledOnce();
    expect(closeNotification).toHaveBeenCalledOnce();
  });

  it('closes a late notification after dismissal instead of leaving a stale toast', async () => {
    const { incoming, capabilities, closeNotification } = setup();
    let finish!: (value: () => void) => void;
    capabilities.notify.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    incoming.receive(invitation);
    await settleNotification();
    incoming.dismiss(incoming.invitations()[0]);
    finish(closeNotification);
    await settleNotification();
    expect(closeNotification).toHaveBeenCalledOnce();
  });
});
