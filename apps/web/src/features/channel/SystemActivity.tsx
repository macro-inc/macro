import { getDisplayName, tryMacroId } from '@core/user';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { SystemActivityRow } from './components/SystemActivityRow';
import type { SystemActivity as SystemActivityEvent } from './core/system-activity';

function name(id: string): string {
  return getBotDisplayName(id) || getDisplayName(tryMacroId(id)) || 'Someone';
}

/** App composition uses the same cached principal names as channel messages. */
export function SystemActivity(props: { event: SystemActivityEvent }) {
  const participant = () =>
    'participant' in props.event.action
      ? name(props.event.action.participant)
      : 'a participant';
  return (
    <SystemActivityRow
      event={props.event}
      actorName={name(props.event.actorId)}
      participantName={participant()}
    />
  );
}
