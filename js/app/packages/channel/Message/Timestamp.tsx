import { cn } from '@ui/utils/classname';
import { formatDate } from '@core/util/date';
import { useMessage } from './context';

type TimestampProps = {
  class?: string;
};

export function Timestamp(props: TimestampProps) {
  const message = useMessage();

  return (
    <span class={cn('text-xs text-secondary-fg', props.class)}>
      {formatDate(message().created_at)}
    </span>
  );
}
