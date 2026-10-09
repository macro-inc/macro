import { match } from 'ts-pattern';

export type SystemActivity = {
  id: string;
  actorId: string;
  occurredAt: string;
  action:
    | { kind: 'renamed'; name?: string }
    | { kind: 'picture_changed' }
    | { kind: 'participant_added'; participant: string }
    | { kind: 'participant_removed'; participant: string }
    | { kind: 'call_ended'; durationMs: number }
    | { kind: 'unknown' };
};

export function callDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${remainder ? ` ${remainder} ${remainder === 1 ? 'minute' : 'minutes'}` : ''}`;
}

export function systemActivityDescription(
  event: SystemActivity,
  participantName: string
): { verb: string; subject?: string } {
  return match(event.action)
    .with({ kind: 'renamed' }, ({ name }) =>
      name
        ? { verb: 'renamed the channel to', subject: name }
        : { verb: 'renamed the channel' }
    )
    .with({ kind: 'picture_changed' }, () => ({
      verb: 'updated the channel profile picture',
    }))
    .with({ kind: 'participant_added' }, ({ participant }) =>
      participant === event.actorId
        ? { verb: 'joined the channel' }
        : { verb: 'added', subject: participantName }
    )
    .with({ kind: 'participant_removed' }, ({ participant }) =>
      participant === event.actorId
        ? { verb: 'left the channel' }
        : { verb: 'removed', subject: participantName }
    )
    .with({ kind: 'call_ended' }, ({ durationMs }) => ({
      verb: `started a call that lasted ${callDuration(durationMs)}`,
    }))
    .with({ kind: 'unknown' }, () => ({ verb: 'updated the channel' }))
    .exhaustive();
}

export function describeSystemActivity(
  event: SystemActivity,
  participantName: string
): string {
  const { verb, subject } = systemActivityDescription(event, participantName);
  return subject ? `${verb} ${subject}` : verb;
}
