import FlagIcon from '@phosphor/flag.svg';
import { dueDateFace } from '@property/utils/due-date';
import { cn } from '@ui';

/** Flag plus Today, Yesterday, or a short date. Today is warning-colored; a past day is failure-colored. */
export function DueDateLabel(props: {
  value: Date;
  now?: Date;
  class?: string;
  iconClass?: string;
  textClass?: string;
}) {
  const face = () => dueDateFace(props.value, props.now);
  return (
    <span
      class={cn('inline-flex min-w-0 items-center gap-1', props.class)}
      classList={{
        'text-warning': face().tone === 'today',
        'text-failure': face().tone === 'overdue',
      }}
    >
      <FlagIcon class={cn('size-3 shrink-0', props.iconClass)} />
      <span class={cn('min-w-0 truncate', props.textClass)}>{face().text}</span>
    </span>
  );
}
