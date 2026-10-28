import { getDisplayName, tryMacroId } from '@core/user';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { match } from 'ts-pattern';
import { SystemActivityRow } from './components/SystemActivityRow';
import type { SystemActivity as SystemActivityEvent } from './core/system-activity';

function name(id: string): string {
  return getBotDisplayName(id) || getDisplayName(tryMacroId(id)) || 'Someone';
}

/** App composition uses the same cached principal names as channel messages. */
export function SystemActivity(props: { event: SystemActivityEvent }) {
  const participant = () =>
    match(props.event.action)
      .with({ kind: 'participant_added' }, ({ participants }) =>
        participants.map(name).join(', ')
      )
      .with({ kind: 'participant_removed' }, ({ participant }) =>
        name(participant)
      )
      .with(
        { kind: 'renamed' },
        { kind: 'picture_changed' },
        { kind: 'call_ended' },
        { kind: 'unknown' },
        () => 'a participant'
      )
      .exhaustive();
  return (
    <SystemActivityRow
      event={props.event}
      actorName={name(props.event.actorId)}
      participantName={participant()}
    />
  );
}
