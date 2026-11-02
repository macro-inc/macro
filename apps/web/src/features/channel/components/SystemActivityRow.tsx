import { formatDate, formatEmailDate } from '@core/util/date';
import PhoneIcon from '@icon/system/fill/phone-fill.svg';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import ImageIcon from '@icon/system/regular/image.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
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

/** One-line system activity; long descriptions truncate with a tooltip. */
export function SystemActivityRow(props: {
  event: SystemActivity;
  actorName: string;
  participantName: string;
}) {
  const description = () =>
    systemActivityDescription(props.event, props.participantName);
  return (
    <SystemActivityLine
      id={props.event.id}
      icon={ACTIVITY_ICONS[props.event.action.kind]}
      iconClass={
        props.event.action.kind === 'call_ended' ||
        props.event.action.kind === 'participant_added'
          ? 'text-success'
          : undefined
      }
      actor={props.actorName}
      verb={description().verb}
      subject={description().subject}
      label={`${props.actorName} ${describeSystemActivity(props.event, props.participantName)}`}
      occurredAt={props.event.occurredAt}
      wrap={
        props.event.action.kind === 'participant_added' &&
        props.event.action.participants.length > 1
      }
    />
  );
}

/**
 * The row itself, for any conversation's system events (a WhatsApp group's
 * included): icon in the avatar column, bold actor and subject, time.
 */
export function SystemActivityLine(props: {
  id: string;
  icon: typeof PencilIcon;
  iconClass?: string;
  /** Omitted when nobody is named; the verb then starts the line. */
  actor?: string;
  verb: string;
  subject?: string;
  /** The whole line, for the tooltip. */
  label: string;
  occurredAt: string;
  /**
   * Wrap instead of truncating, for lines listing several names: the tooltip
   * that reveals a truncated line is unavailable on touch devices.
   */
  wrap?: boolean;
}) {
  return (
    <div
      class={cn(
        'flex items-center gap-2 pl-(--message-padding-x) pr-2 text-sm text-ink-muted',
        props.wrap ? 'min-h-9 py-2' : 'h-9'
      )}
      data-system-activity={props.id}
    >
      <span
        class="w-(--user-icon-width) shrink-0 flex justify-center"
        aria-hidden="true"
      >
        <Dynamic
          component={props.icon}
          class={cn('size-4.5', props.iconClass)}
        />
      </span>
      <Tooltip
        label={props.label}
        class={cn('min-w-0 max-w-max flex-1', !props.wrap && 'truncate')}
        as="span"
      >
        <span class={props.wrap ? undefined : 'truncate'}>
          <Show when={props.actor}>
            {(actor) => (
              <>
                <span class="font-medium text-ink">{actor()}</span>{' '}
              </>
            )}
          </Show>
          {props.verb}
          <Show when={props.subject}>
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
        dateTime={props.occurredAt}
        title={formatEmailDate(props.occurredAt)}
      >
        {formatDate(props.occurredAt, { showTime: true })}
      </time>
    </div>
  );
}
