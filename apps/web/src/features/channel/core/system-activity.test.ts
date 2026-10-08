import { expect, it } from 'vitest';
import { decodeSystemActivity } from '../queries/system-activity';
import { callDuration, describeSystemActivity } from './system-activity';

it('describes completed calls, renames, and self membership changes', () => {
  const event = {
    id: 'a',
    actor_id: 'macro|teo@example.com',
    occurred_at: '2026-09-19T12:00:00Z',
  };
  expect(
    describeSystemActivity(
      decodeSystemActivity({
        ...event,
        action: 'call_ended',
        payload: { duration_ms: 480000 },
      }),
      ''
    )
  ).toBe('started a call that lasted 8 minutes');
  expect(
    describeSystemActivity(
      decodeSystemActivity({
        ...event,
        action: 'renamed',
        payload: { to: 'Planning' },
      }),
      ''
    )
  ).toBe('renamed the channel to Planning');
  expect(
    describeSystemActivity(
      decodeSystemActivity({
        ...event,
        action: 'participant_added',
        payload: { participant: event.actor_id },
      }),
      'Teo'
    )
  ).toBe('joined the channel');
});

it('formats durations and tolerates malformed future activity', () => {
  expect(callDuration(1000)).toBe('1 second');
  expect(callDuration(3600000)).toBe('1 hour');
  expect(callDuration(3660000)).toBe('1 hour 1 minute');
  expect(
    decodeSystemActivity({
      id: 'a',
      actor_id: 'user',
      occurred_at: '',
      action: 'future',
      payload: null,
    }).action.kind
  ).toBe('unknown');
});
