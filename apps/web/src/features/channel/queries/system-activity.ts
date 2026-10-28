import type { TimelineActivity } from '@service-storage/messages';
import { isSelfJoin, type SystemActivity } from '../core/system-activity';

/** Decode the durable vocabulary at the transport boundary, tolerating future actions. */
export function decodeSystemActivity(event: TimelineActivity): SystemActivity {
  const payload: unknown = event.payload;
  const fields = typeof payload === 'object' && payload !== null ? payload : {};
  let action: SystemActivity['action'] = { kind: 'unknown' };
  if (event.action === 'picture_changed') action = { kind: 'picture_changed' };
  if (event.action === 'renamed')
    action = {
      kind: 'renamed',
      name:
        'to' in fields && typeof fields.to === 'string' ? fields.to : undefined,
    };
  if ('participant' in fields && typeof fields.participant === 'string') {
    if (event.action === 'participant_added')
      action = {
        kind: 'participant_added',
        participants: [fields.participant],
      };
    if (event.action === 'participant_removed')
      action = { kind: 'participant_removed', participant: fields.participant };
  }
  if (
    event.action === 'call_ended' &&
    'duration_ms' in fields &&
    typeof fields.duration_ms === 'number' &&
    Number.isFinite(fields.duration_ms)
  ) {
    action = { kind: 'call_ended', durationMs: fields.duration_ms };
  }
  return {
    id: event.id,
    actorId: event.actor_id,
    occurredAt: event.occurred_at,
    action,
  };
}

function addedParticipants(event: SystemActivity): string[] | undefined {
  return event.action.kind === 'participant_added' && !isSelfJoin(event)
    ? event.action.participants
    : undefined;
}

/** One actor adding people in succession shares a row; joining keeps its own. */
export function mergesSystemActivity(
  previous: TimelineActivity,
  next: TimelineActivity
): boolean {
  const before = decodeSystemActivity(previous);
  const after = decodeSystemActivity(next);
  return (
    before.actorId === after.actorId &&
    addedParticipants(before) !== undefined &&
    addedParticipants(after) !== undefined
  );
}

/** A row's activities, oldest first, as one event dated by the newest. */
export function decodeSystemActivityRow(
  activities: readonly TimelineActivity[]
): SystemActivity {
  const events = activities.map(decodeSystemActivity);
  const newest = events[events.length - 1];
  if (events.length === 1 || newest.action.kind !== 'participant_added')
    return newest;
  return {
    ...newest,
    action: {
      kind: 'participant_added',
      participants: events.flatMap((event) => addedParticipants(event) ?? []),
    },
  };
}
