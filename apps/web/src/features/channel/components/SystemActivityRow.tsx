import { formatDate, formatEmailDate } from '@core/util/date';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import ImageIcon from '@phosphor/image.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PhoneIcon from '@phosphor-fill/phone-fill.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  describeSystemActivity,
  type SystemActivity,
  systemActivityDescription,
} from '../core/system-activity';

const ACTIVITY_ICONS = {
  renamed: PencilIcon,
  picture_changed: ImageIcon,
  participant_added: ArrowRightIcon,
  participant_removed: ArrowLeftIcon,
  call_ended: PhoneIcon,
  unknown: PencilIcon,
} satisfies Record<SystemActivity['action']['kind'], typeof PencilIcon>;

/** Names and durations can settle without changing this row's reserved height. */
export function SystemActivityRow(props: {
  event: SystemActivity;
  actorName: string;
  participantName: string;
}) {
  const description = () =>
    systemActivityDescription(props.event, props.participantName);
  const label = () =>
    `${props.actorName} ${describeSystemActivity(props.event, props.participantName)}`;
  return (
    <div
      class="h-9 min-h-9 flex items-center gap-2 pl-(--message-padding-x) pr-2 text-sm text-ink-muted"
      data-system-activity={props.event.id}
    >
      <span
        class="w-(--user-icon-width) shrink-0 flex justify-center"
        aria-hidden="true"
      >
        <Dynamic
          component={ACTIVITY_ICONS[props.event.action.kind]}
          class={cn(
            'size-4.5',
            (props.event.action.kind === 'call_ended' ||
              props.event.action.kind === 'participant_added') &&
              'text-success'
          )}
        />
      </span>
      <Tooltip
        label={label()}
        class="min-w-0 max-w-max flex-1 truncate"
        as="span"
      >
        <span class="truncate">
          <span class="font-medium text-ink">{props.actorName}</span>{' '}
          {description().verb}
          <Show when={description().subject}>
            {(subject) => (
              <>
                {' '}
                <span class="font-medium text-ink">{subject()}</span>
              </>
            )}
          </Show>
        </span>
      </Tooltip>
      <time
        class="shrink-0 text-xs text-ink-extra-muted"
        dateTime={props.event.occurredAt}
        title={formatEmailDate(props.event.occurredAt)}
      >
        {formatDate(props.event.occurredAt, { showTime: true })}
      </time>
    </div>
  );
}
