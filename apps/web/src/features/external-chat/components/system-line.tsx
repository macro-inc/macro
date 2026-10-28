import { SystemActivityLine } from '@channel/components/SystemActivityRow';
import ImageIcon from '@phosphor/image.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PushPinIcon from '@phosphor/push-pin.svg';
import TimerIcon from '@phosphor/timer.svg';
import UserMinusIcon from '@phosphor/user-minus.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import PhoneIcon from '@phosphor-fill/phone-fill.svg';
import {
  describeSystemLine,
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

/** A provider event in the chat, drawn like Chat's system activity rows. */
export function ExternalChatSystemLine(props: {
  id: string;
  line: SystemLine;
  chat: 'group' | 'direct';
  occurredAt: string;
}) {
  const text = () => describeSystemLine(props.line, props.chat);
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
