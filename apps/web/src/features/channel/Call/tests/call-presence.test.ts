import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallPresence, parseCallPresenceMessage } from '../call-presence';

describe('call presence sounds', () => {
  const play = vi.fn();
  let presence: ReturnType<typeof createCallPresence>;
  let visit = 0;

  beforeEach(() => {
    play.mockClear();
    visit = 0;
    presence = createCallPresence({
      play,
      createVisitId: () => `visit-${++visit}`,
    });
  });

  it('plays only self join for the initial roster, including delayed announcements', () => {
    expect(presence.joined('call-1', ['peer-1', 'peer-2'], false)).toEqual({
      callId: 'call-1',
      visitId: 'visit-1',
      event: 'join',
    });
    presence.receive(
      { callId: 'call-1', visitId: 'old-visit-1', event: 'join' },
      { sid: 'peer-1', identity: 'peer-1' }
    );
    presence.receive(
      { callId: 'call-1', visitId: 'old-visit-2', event: 'join' },
      { sid: 'peer-2', identity: 'peer-2' }
    );
    expect(play.mock.calls).toEqual([['join']]);
  });

  it('plays an arriving peer and an initial peer leaving, once each', () => {
    presence.joined('call-1', ['peer-1'], false);
    play.mockClear();
    const join = {
      callId: 'call-1',
      visitId: 'peer-visit',
      event: 'join' as const,
    };
    const leave = {
      callId: 'call-1',
      visitId: 'initial-visit',
      event: 'leave' as const,
    };
    presence.receive(join, { sid: 'peer-2', identity: 'peer-2' });
    presence.receive(join, { sid: 'peer-2', identity: 'peer-2' });
    presence.receive(leave, { sid: 'peer-1', identity: 'peer-1' });
    presence.receive(leave, { sid: 'peer-1', identity: 'peer-1' });
    expect(play.mock.calls).toEqual([['join'], ['leave']]);
  });

  it('announces self leave once and allows an intentional rejoin to the same call', () => {
    presence.joined('call-1', [], false);
    expect(presence.left()).toEqual({
      callId: 'call-1',
      visitId: 'visit-1',
      event: 'leave',
    });
    expect(presence.left()).toBeUndefined();
    expect(presence.joined('call-1', [], false)).toEqual({
      callId: 'call-1',
      visitId: 'visit-2',
      event: 'join',
    });
    expect(play.mock.calls).toEqual([['join'], ['leave'], ['join']]);
  });

  it('does not announce duplicate joins or self recovery with a replacement room', () => {
    presence.joined('call-1', ['peer-1'], false);
    play.mockClear();
    expect(presence.joined('call-1', ['peer-1'], false)).toBeUndefined();
    expect(presence.joined('call-1', ['recovered-peer'], true)).toBeUndefined();
    presence.receive(
      { callId: 'call-1', visitId: 'old-visit', event: 'join' },
      { sid: 'recovered-peer', identity: 'peer-1' }
    );
    expect(play).not.toHaveBeenCalled();
    expect(presence.left()?.visitId).toBe('visit-1');
  });

  it('starts a restored visit silently but can play its later intentional leave', () => {
    expect(presence.joined('call-1', ['peer-1'], true)).toBeUndefined();
    expect(play).not.toHaveBeenCalled();
    presence.left();
    expect(play.mock.calls).toEqual([['leave']]);
  });

  it('allows an initial peer to intentionally rejoin with a new RTC session', () => {
    presence.joined('call-1', ['peer-1'], false);
    play.mockClear();
    presence.receive(
      { callId: 'call-1', visitId: 'old-visit', event: 'leave' },
      { sid: 'peer-1', identity: 'peer-1' }
    );
    presence.receive(
      { callId: 'call-1', visitId: 'new-visit', event: 'join' },
      { sid: 'peer-1-new', identity: 'peer-1' }
    );
    expect(play.mock.calls).toEqual([['leave'], ['join']]);
  });

  it('ignores messages before joining, after leaving, and for another call', () => {
    const message = {
      callId: 'call-1',
      visitId: 'peer-visit',
      event: 'join' as const,
    };
    presence.receive(message, { sid: 'peer-1', identity: 'peer-1' });
    presence.joined('call-2', [], false);
    presence.receive(message, { sid: 'peer-1', identity: 'peer-1' });
    presence.left();
    play.mockClear();
    presence.receive(message, { sid: 'peer-1', identity: 'peer-1' });
    expect(play).not.toHaveBeenCalled();
  });

  it('does not confuse different peers that happen to use the same visit id', () => {
    presence.joined('call-1', [], false);
    play.mockClear();
    const message = {
      callId: 'call-1',
      visitId: 'peer-visit',
      event: 'join' as const,
    };
    presence.receive(message, { sid: 'peer-1', identity: 'peer-1' });
    presence.receive(message, { sid: 'peer-2', identity: 'peer-2' });
    expect(play.mock.calls).toEqual([['join'], ['join']]);
  });
});

it('rejects malformed presence messages', () => {
  for (const value of [
    null,
    [],
    {},
    { callId: 'call-1', event: 'join' },
    { callId: '', visitId: 'visit-1', event: 'leave' },
    { callId: 'call-1', visitId: 1, event: 'leave' },
    { callId: 'call-1', visitId: 'visit-1', event: 'reconnect' },
    { callId: 'call-1', visitId: 'x'.repeat(101), event: 'join' },
  ])
    expect(parseCallPresenceMessage(value)).toBeUndefined();
  expect(
    parseCallPresenceMessage({
      callId: 'call-1',
      visitId: 'visit-1',
      event: 'join',
      senderSid: 'peer-1',
    })
  ).toEqual({
    callId: 'call-1',
    visitId: 'visit-1',
    event: 'join',
    senderSid: 'peer-1',
  });
});
