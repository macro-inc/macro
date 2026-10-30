import { SystemActivityLine } from '@channel/components/SystemActivityRow';
import { getDisplayName, tryMacroId } from '@core/user';
import ImageIcon from '@phosphor/image.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PushPinIcon from '@phosphor/push-pin.svg';
import TimerIcon from '@phosphor/timer.svg';
import UserMinusIcon from '@phosphor/user-minus.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import PhoneIcon from '@phosphor-fill/phone-fill.svg';
import {
  describeSystemLine,
  type Person,
  type SystemLine,
  type SystemLineText,
  systemLineSentence,
} from '../core/rich';

const ICONS = {
  added: UserPlusIcon,
  removed: UserMinusIcon,
  edit: PencilIcon,
  picture: ImageIcon,
  pin: PushPinIcon,
  call: PhoneIcon,
  timer: TimerIcon,
} satisfies Record<SystemLineText['icon'], typeof PencilIcon>;

/** Macro users go by their Macro name, as their messages do. */
function named(person: Person): Person {
  const id = person.userId ? tryMacroId(person.userId) : undefined;
  return id ? { ...person, name: getDisplayName(id) } : person;
}

/** A provider event in the chat, drawn like Chat's system activity rows. */
export function ExternalChatSystemLine(props: {
  id: string;
  line: SystemLine;
  chat: 'group' | 'direct';
  occurredAt: string;
}) {
  const text = () =>
    describeSystemLine(
      {
        ...props.line,
        actor: props.line.actor && named(props.line.actor),
        participants: props.line.participants.map(named),
      },
      props.chat
    );
  return (
    <SystemActivityLine
      id={props.id}
      icon={ICONS[text().icon]}
      iconClass={
        props.line.action === 'call' && props.line.call?.outcome === 'missed'
          ? 'text-failure-ink'
          : text().icon === 'added'
            ? 'text-success'
            : undefined
      }
      actor={text().actor}
      verb={text().verb}
      subject={text().subject}
      label={systemLineSentence(text())}
      occurredAt={props.occurredAt}
    />
  );
}
