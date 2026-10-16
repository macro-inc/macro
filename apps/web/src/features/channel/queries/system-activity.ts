import type { TimelineActivity } from '@service-storage/messages';
import type { SystemActivity } from '../core/system-activity';

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
  if (
    (event.action === 'participant_added' ||
      event.action === 'participant_removed') &&
    'participant' in fields &&
    typeof fields.participant === 'string'
  ) {
    action = { kind: event.action, participant: fields.participant };
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
