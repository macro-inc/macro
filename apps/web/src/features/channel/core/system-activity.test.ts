import { buildMessageIndex } from '@queries/messages/timeline';
import type {
  MessageTimelineEntry,
  TimelineActivity,
} from '@service-storage/messages';
import { expect, it } from 'vitest';
import {
  decodeSystemActivity,
  decodeSystemActivityRow,
  mergesSystemActivity,
} from '../queries/system-activity';
import { callDuration, describeSystemActivity } from './system-activity';

const ACTOR = 'macro|owner@example.com';

function added(
  id: string,
  participant: string,
  actor = ACTOR
): MessageTimelineEntry {
  return {
    type: 'activity',
    activity: {
      id,
      actor_id: actor,
      action: 'participant_added',
      occurred_at: '2026-09-19T12:00:00Z',
      payload: { participant },
    },
  };
}

/** Index entries given oldest first, as the channel builds them. */
function index(entries: MessageTimelineEntry[]) {
  return buildMessageIndex(
    [
      {
        entries: [...entries].reverse(),
        next_cursor: null,
        previous_cursor: null,
      },
    ],
    mergesSystemActivity
  );
}

function rowActivities(
  built: ReturnType<typeof index>,
  key: string
): TimelineActivity[] {
  const activity = built.activityByKey.get(key);
  return built.activityGroupByKey.get(key) ?? (activity ? [activity] : []);
}

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

it('merges consecutive additions by one actor into a row keyed by the newest', () => {
  const built = index([
    added('a', 'macro|a@example.com'),
    added('b', 'macro|b@example.com'),
    added('c', 'macro|c@example.com'),
  ]);
  expect(built.entryKeys).toEqual(['activity:c']);
  const row = decodeSystemActivityRow(rowActivities(built, 'activity:c'));
  expect(row.id).toBe('c');
  expect(row.action).toEqual({
    kind: 'participant_added',
    participants: [
      'macro|a@example.com',
      'macro|b@example.com',
      'macro|c@example.com',
    ],
  });
  expect(describeSystemActivity(row, 'A, B, C')).toBe('added A, B, C');
});

it('keeps additions apart across other actors, joins, and messages', () => {
  const built = index([
    added('a', 'macro|a@example.com'),
    added('other', 'macro|b@example.com', 'macro|other@example.com'),
    added('join', 'macro|other@example.com', 'macro|other@example.com'),
    added('b', 'macro|b@example.com'),
    {
      type: 'message',
      message: {
        id: 'm',
        created_at: '2026-09-19T12:01:00Z',
      } as Extract<MessageTimelineEntry, { type: 'message' }>['message'],
    },
    added('c', 'macro|c@example.com'),
  ]);
  expect(built.entryKeys).toEqual([
    'activity:a',
    'activity:other',
    'activity:join',
    'activity:b',
    'm',
    'activity:c',
  ]);
  expect(built.activityGroupByKey.size).toBe(0);
  expect(
    describeSystemActivity(
      decodeSystemActivityRow(rowActivities(built, 'activity:join')),
      ''
    )
  ).toBe('joined the channel');
});
