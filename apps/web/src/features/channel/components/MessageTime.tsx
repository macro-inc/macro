import { useCurrentDay } from '@core/signal/currentDay';
import { formatFullDateTime, formatMessageTime } from '@core/util/date';
import { cn, Tooltip } from '@ui';

type MessageTimeProps = {
  at: string;
  class?: string;
};

/** When something in a conversation happened, with the whole date on hover. */
export function MessageTime(props: MessageTimeProps) {
  const currentDay = useCurrentDay();

  return (
    <Tooltip.Root placement="top">
      <Tooltip.Trigger
        as="time"
        class={cn('text-xs text-ink-extra-muted', props.class)}
        dateTime={props.at}
      >
        {formatMessageTime(props.at, currentDay())}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content>{formatFullDateTime(props.at)}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
