import { SystemActivityLine } from '@channel/components/SystemActivityRow';
import { getDisplayName, tryMacroId } from '@core/user';
import PhoneFillIcon from '@icon/system/fill/phone-fill.svg';
import type { Message } from '@service-storage/messages';

export function callerName(message: Message): string {
  return getDisplayName(tryMacroId(message.sender_id)) || 'Someone';
}

/** The system line for a call that is over, or whose record is gone. */
export function PastCallLine(props: {
  message: Message;
  verb: string;
  at: string;
}) {
  return (
    <div data-message-id={props.message.id}>
      <SystemActivityLine
        id={props.message.id}
        icon={PhoneFillIcon}
        iconClass="text-success"
        actor={callerName(props.message)}
        verb={props.verb}
        label={`${callerName(props.message)} ${props.verb}`}
        occurredAt={props.at}
      />
    </div>
  );
}

/** A call's root outside the channel timeline, where its life isn't known. */
export function DetachedCallRootLine(props: { message: Message }) {
  return (
    <PastCallLine
      message={props.message}
      verb="started a call"
      at={props.message.created_at}
    />
  );
}
