import { describe, expect, it, vi } from 'vitest';
import { isCallEventType, parseCallEvent } from '../call-events';

// `call-events` also exports the Solid websocket subscription used by the app.
// Keep these parser tests from constructing that application-wide socket in
// jsdom; the payload parser itself remains real and side-effect free.
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));

// The connection gateway always sends `data` as a JSON string — see
// `services/connection_gateway/src/model/message.rs`.
const wire = (payload: unknown) => JSON.stringify(payload);

describe('isCallEventType', () => {
  it('accepts the four call events', () => {
    expect(isCallEventType('call_started')).toBe(true);
    expect(isCallEventType('call_ended')).toBe(true);
    expect(isCallEventType('call_answered')).toBe(true);
    expect(isCallEventType('call_share_with_team_toggled')).toBe(true);
  });

  it('rejects unrelated event types', () => {
    expect(isCallEventType('comms_message')).toBe(false);
    expect(isCallEventType('')).toBe(false);
  });
});

describe('parseCallEvent', () => {
  it('parses call_started from a JSON string', () => {
    expect(
      parseCallEvent(
        'call_started',
        wire({ channel_id: 'chan-1', call_id: 'call-1', created_by: 'user-1' })
      )
    ).toEqual({
      type: 'call_started',
      channelId: 'chan-1',
      callId: 'call-1',
      createdBy: 'user-1',
    });
  });

  it('parses an already-parsed object payload', () => {
    expect(
      parseCallEvent('call_ended', { channel_id: 'chan-1', call_id: 'call-1' })
    ).toEqual({ type: 'call_ended', channelId: 'chan-1', callId: 'call-1' });
  });

  it('parses call_answered and defaults the optional fields', () => {
    expect(
      parseCallEvent('call_answered', wire({ call_id: 'call-1' }))
    ).toEqual({
      type: 'call_answered',
      channelId: null,
      callId: 'call-1',
      answeredBy: null,
    });
  });

  it('keeps the answering user id when present', () => {
    expect(
      parseCallEvent(
        'call_answered',
        wire({ channel_id: 'chan-1', call_id: 'call-1', user_id: 'user-2' })
      )
    ).toEqual({
      type: 'call_answered',
      channelId: 'chan-1',
      callId: 'call-1',
      answeredBy: 'user-2',
    });
  });

  it('parses call_share_with_team_toggled', () => {
    expect(
      parseCallEvent(
        'call_share_with_team_toggled',
        wire({
          channel_id: 'chan-1',
          call_id: 'call-1',
          share_with_team: true,
          toggled_by: 'user-3',
        })
      )
    ).toEqual({
      type: 'call_share_with_team_toggled',
      channelId: 'chan-1',
      callId: 'call-1',
      shareWithTeam: true,
      toggledBy: 'user-3',
    });
  });

  it('returns null for a non-call event type', () => {
    expect(parseCallEvent('comms_message', wire({ call_id: 'call-1' }))).toBe(
      null
    );
  });

  it('returns null for malformed JSON without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseCallEvent('call_started', 'not json')).toBe(null);
    warn.mockRestore();
  });

  it.each([
    ['call_started', { call_id: 'call-1' }],
    ['call_started', { channel_id: 'chan-1' }],
    ['call_ended', { call_id: 'call-1' }],
    ['call_ended', { channel_id: 'chan-1' }],
    ['call_answered', { channel_id: 'chan-1' }],
  ])('returns null when %s is missing a required id', (type, payload) => {
    expect(parseCallEvent(type, wire(payload))).toBe(null);
  });

  it('returns null when share_with_team is not a boolean', () => {
    expect(
      parseCallEvent(
        'call_share_with_team_toggled',
        wire({ channel_id: 'chan-1', call_id: 'call-1' })
      )
    ).toBe(null);
  });

  it('returns null for a null payload', () => {
    expect(parseCallEvent('call_started', wire(null))).toBe(null);
  });
});
