import { isMobileWidth } from '@core/mobile/mobileWidth';
import { formatDate, formatTime } from '@core/util/date';
import { cn } from '@ui';
import { Match, Switch } from 'solid-js';
import { useMessage } from './context';

type TimestampProps = {
  class?: string;
  compact?: boolean;
  format?: 'dateAndTime' | 'time';
};

export function Timestamp(props: TimestampProps) {
  const message = useMessage();

  return (
    <span
      class={cn(
        'text-xs text-ink-extra-muted tabular-nums',
        props.compact && 'leading-none',
        props.class
      )}
      // The time-only format reveals the full date on hover.
      title={
        props.format === 'time'
          ? formatDate(message().created_at, { showTime: true })
          : undefined
      }
    >
      <Switch>
        <Match when={props.format === 'time'}>
          {formatTime(message().created_at)}
        </Match>
        <Match when={props.format === 'dateAndTime' || true}>
          {formatDate(message().created_at, {
            showTime: true,
            shortWeekday: isMobileWidth(),
          })}
        </Match>
      </Switch>
    </span>
  );
}
