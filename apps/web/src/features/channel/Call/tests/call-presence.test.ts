import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCallPresence } from '../call-presence';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('bounds fresh-visit bursts without replaying suppressed announcements later', () => {
  const play = vi.fn();
  const presence = createCallPresence({
    play,
    createVisitId: () => 'local-visit',
  });
  presence.joined('call-1', [], false);
  play.mockClear();
  vi.advanceTimersByTime(2_000);

  for (let index = 0; index < 20; index += 1) {
    presence.receive(
      {
        callId: 'call-1',
        visitId: `visit-${index}`,
        event: index % 2 === 0 ? 'join' : 'leave',
      },
      { sid: `sid-${index}`, identity: 'remote-user' }
    );
  }
  expect(play).toHaveBeenCalledExactlyOnceWith('join');

  vi.advanceTimersByTime(2_000);
  presence.receive(
    { callId: 'call-1', visitId: 'visit-19', event: 'leave' },
    { sid: 'sid-19', identity: 'remote-user' }
  );
  expect(play).toHaveBeenCalledTimes(1);
  presence.receive(
    { callId: 'call-1', visitId: 'next-visit', event: 'join' },
    { sid: 'next-sid', identity: 'remote-user' }
  );
  expect(play).toHaveBeenCalledTimes(2);
});

it('keeps local and remote recovery silent and deduplicates real visits', () => {
  const play = vi.fn();
  const presence = createCallPresence({
    play,
    createVisitId: () => 'local-visit',
  });
  expect(presence.joined('call-1', ['initial-sid'], false)).toMatchObject({
    event: 'join',
  });
  vi.advanceTimersByTime(2_000);
  const sender = { sid: 'initial-sid', identity: 'remote-user' };
  presence.receive(
    { callId: 'call-1', visitId: 'old-visit', event: 'join' },
    sender
  );
  expect(play).toHaveBeenCalledTimes(1);

  const arrival = {
    callId: 'call-1',
    visitId: 'new-visit',
    event: 'join' as const,
  };
  const newcomer = { sid: 'new-sid', identity: 'another-user' };
  presence.receive(arrival, newcomer);
  presence.receive(arrival, newcomer);
  expect(play).toHaveBeenCalledTimes(2);

  expect(
    presence.joined('call-1', ['recovered-sid', 'new-sid'], true)
  ).toBeUndefined();
  presence.receive(arrival, newcomer);
  presence.receive(
    { callId: 'call-1', visitId: 'recovery-visit', event: 'join' },
    { sid: 'recovered-sid', identity: 'remote-user' }
  );
  expect(play).toHaveBeenCalledTimes(2);

  vi.advanceTimersByTime(2_000);
  const departure = {
    callId: 'call-1',
    visitId: 'new-visit',
    event: 'leave' as const,
  };
  presence.receive(departure, newcomer);
  presence.receive(departure, newcomer);
  expect(play).toHaveBeenCalledTimes(3);
});
