import { cn } from '@ui';
import { MessageTime } from '../components/MessageTime';
import { useMessage } from './context';

type TimestampProps = {
  class?: string;
};

export function Timestamp(props: TimestampProps) {
  const message = useMessage();

  return (
    <MessageTime
      at={message().created_at}
      class={cn('tabular-nums', props.class)}
    />
  );
}
