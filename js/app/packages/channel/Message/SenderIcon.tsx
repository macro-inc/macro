import { cn } from '@ui/utils/classname';
import { UserIcon } from '@core/component/UserIcon';
import { useMessage } from './context';

type SenderIconProps = {
  class?: string;
};

export function SenderIcon(props: SenderIconProps) {
  const message = useMessage();

  return (
    <div class={cn('flex-shrink-0', props.class)}>
      <UserIcon id={message.sender_id} size="sm" />
    </div>
  );
}
