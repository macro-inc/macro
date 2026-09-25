import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMeetingInvitationEventsEffect,
  parseMeetingInvitationEvent,
} from '../meeting-invitation-events';

const mocks = vi.hoisted(() => ({
  enabled: true,
  userId: 'macro|recipient@example.com',
  subscribe: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_CALLS() {
    return mocks.enabled;
  },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => mocks.userId }));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: mocks.subscribe,
}));

const payload = {
  meeting_id: 'meeting-1',
  share_token: 'standalone-share-token',
  title: 'Planning',
  created_by: 'macro|caller@example.com',
  invited_at: '2026-09-23T14:00:00Z',
  expires_at: '2026-09-23T14:00:30Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.userId = 'macro|recipient@example.com';
});

describe('meeting invitation events', () => {
  it('silently rejects malformed JSON without logging its bearer share token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        parseMeetingInvitationEvent(
          'meeting_invited',
          '{"share_token":"private-meeting-token",broken'
        )
      ).toBeNull();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('parses a targeted invitation without a channel or live call id', () => {
    expect(
      parseMeetingInvitationEvent('meeting_invited', JSON.stringify(payload))
    ).toEqual({
      type: 'meeting_invited',
      meetingId: 'meeting-1',
      shareToken: payload.share_token,
      title: 'Planning',
      createdBy: payload.created_by,
      invitedAt: payload.invited_at,
      expiresAt: payload.expires_at,
    });
  });

  it.each([
    { meeting_id: '' },
    { share_token: 4 },
    { created_by: null },
    { title: null },
    { invited_at: 'invalid' },
    { expires_at: '2026-09-23T13:59:00Z' },
  ])('rejects malformed invitation fields %j', (changes) => {
    expect(
      parseMeetingInvitationEvent('meeting_invited', { ...payload, ...changes })
    ).toBeNull();
  });

  it('parses targeted answers and ignores other event types', () => {
    expect(
      parseMeetingInvitationEvent('meeting_answered', {
        meeting_id: 'meeting-1',
        user_id: mocks.userId,
      })
    ).toEqual({
      type: 'meeting_answered',
      meetingId: 'meeting-1',
      userId: mocks.userId,
    });
    expect(
      parseMeetingInvitationEvent('meeting_answered', {
        meeting_id: 'meeting-1',
      })
    ).toBeNull();
    expect(parseMeetingInvitationEvent('call_started', payload)).toBeNull();
  });

  it('gates feature availability, self echoes, signed-out users and other recipients’ answers', () => {
    const onInvited = vi.fn();
    const onAnswered = vi.fn();
    createMeetingInvitationEventsEffect({ onInvited, onAnswered });
    const deliver = mocks.subscribe.mock.calls[0][0];
    deliver({ type: 'meeting_invited', data: JSON.stringify(payload) });
    expect(onInvited).toHaveBeenCalledOnce();
    deliver({
      type: 'meeting_invited',
      data: { ...payload, created_by: mocks.userId },
    });
    deliver({
      type: 'meeting_answered',
      data: { meeting_id: 'meeting-1', user_id: 'macro|other@example.com' },
    });
    expect(onAnswered).not.toHaveBeenCalled();
    deliver({
      type: 'meeting_answered',
      data: { meeting_id: 'meeting-1', user_id: mocks.userId },
    });
    expect(onAnswered).toHaveBeenCalledOnce();
    mocks.enabled = false;
    deliver({ type: 'meeting_invited', data: payload });
    mocks.enabled = true;
    mocks.userId = '';
    deliver({ type: 'meeting_invited', data: payload });
    expect(onInvited).toHaveBeenCalledOnce();
  });
});
