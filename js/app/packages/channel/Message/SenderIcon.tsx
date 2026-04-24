import { cn } from '@ui/utils/classname';
import { UserIcon } from '@core/component/UserIcon';
import { useMessage } from './context';

type SenderIconProps = {
  class?: string;
  hidden?: boolean;
};

export function SenderIcon(props: SenderIconProps) {
  const message = useMessage();

  return (
    <div
      class={cn('shrink-0 size-(--user-icon-width)', props.class, {
        invisible: props.hidden,
      })}
      aria-hidden={props.hidden ? 'true' : undefined}
    >
      {!props.hidden && <UserIcon id={message().sender_id} size="fill" />}
    </div>
  );
}
