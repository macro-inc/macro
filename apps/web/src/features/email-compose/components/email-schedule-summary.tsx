import type { EmailScheduleState } from '@app/features/email-compose/primitives/email-send-schedule';
import { formatTimeZoneAbbreviation } from '@core/util/date';
import ClockIcon from '@phosphor/clock.svg';
import { Button, cn } from '@ui';
import { format } from 'date-fns/format';
import { Show, type VoidComponent } from 'solid-js';

interface EmailScheduleSummaryProps {
  state: EmailScheduleState;
  operation: 'idle' | 'committing' | 'updating' | 'cancelling';
  onSelectTime: (date: Date | null) => void | boolean;
  onCancelSchedule: () => Promise<boolean>;
}

type ScheduleSummary = {
  label: string;
  detail: string | undefined;
  actionLabel: string;
  accessibleActionLabel: string;
  action: () => void;
};

/** A send time with its zone, since the viewer's zone may not be the recipient's. */
function sendTimeLabel(time: Date): string {
  const zone = formatTimeZoneAbbreviation(time);
  const label = format(time, "MMM d 'at' h:mm a");
  return zone ? `${label} ${zone}` : label;
}

function describeSchedule(
  props: EmailScheduleSummaryProps
): ScheduleSummary | undefined {
  const state = props.state;
  if (state.type === 'editing') {
    if (state.intent.type === 'immediate') return undefined;
    return {
      label: `Scheduled send: ${sendTimeLabel(state.intent.sendTime)}`,
      detail: undefined,
      actionLabel: 'Cancel',
      accessibleActionLabel: 'Clear send time',
      action: () => props.onSelectTime(null),
    };
  }
  if (state.proposedTime) {
    return {
      label: `Scheduled for ${sendTimeLabel(state.confirmedTime)}`,
      detail: `Update to ${sendTimeLabel(state.proposedTime)}; original remains active until Update succeeds`,
      actionLabel: 'Cancel change',
      accessibleActionLabel: 'Cancel schedule change',
      action: () => props.onSelectTime(null),
    };
  }
  return {
    label: `Scheduled for ${sendTimeLabel(state.confirmedTime)}`,
    detail: undefined,
    actionLabel: 'Cancel',
    accessibleActionLabel: 'Cancel scheduled send',
    action: () => void props.onCancelSchedule(),
  };
}

function ScheduleSummaryLabel(props: {
  summary: ScheduleSummary;
  class?: string;
}) {
  return (
    <div
      role="status"
      data-testid="schedule-summary-label"
      class={cn('min-w-0 leading-tight', props.class)}
      title={
        props.summary.detail
          ? `${props.summary.label}. ${props.summary.detail}`
          : props.summary.label
      }
    >
      <div class="truncate text-ink-muted">{props.summary.label}</div>
      <Show when={props.summary.detail}>
        {(detail) => (
          <div class="truncate text-ink-extra-muted">{detail()}</div>
        )}
      </Show>
    </div>
  );
}

function ScheduleSummaryAction(props: {
  summary: ScheduleSummary;
  operation: EmailScheduleSummaryProps['operation'];
}) {
  return (
    <Button
      size="sm"
      aria-label={props.summary.accessibleActionLabel}
      tooltip={props.summary.accessibleActionLabel}
      disabled={props.operation !== 'idle'}
      onClick={props.summary.action}
    >
      {props.operation === 'cancelling'
        ? 'Cancelling…'
        : props.summary.actionLabel}
    </Button>
  );
}

/** The send time and its Cancel together, for toolbars with no room for a bar. */
export const EmailScheduleSummary: VoidComponent<EmailScheduleSummaryProps> = (
  props
) => (
  <Show when={describeSchedule(props)}>
    {(summary) => (
      <div
        data-testid="schedule-summary"
        class="mr-auto flex min-w-0 flex-auto items-center gap-1 pr-2 text-xs"
      >
        <ScheduleSummaryLabel summary={summary()} />
        <ScheduleSummaryAction
          summary={summary()}
          operation={props.operation}
        />
      </div>
    )}
  </Show>
);

/**
 * A full-width bar under the composer: the send time on the left and its
 * Cancel at the far edge, so neither competes with the toolbar for room.
 * `class` supplies the surface the bar attaches to.
 */
export const EmailScheduleBar: VoidComponent<
  EmailScheduleSummaryProps & { class?: string }
> = (props) => (
  <Show when={describeSchedule(props)}>
    {(summary) => (
      <div
        data-testid="schedule-summary"
        class={cn(
          'flex min-w-0 items-center gap-2 bg-[color-mix(in_oklch,var(--color-surface-1)_40%,var(--color-surface-2))] text-xs',
          props.class
        )}
      >
        <ClockIcon class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        <ScheduleSummaryLabel summary={summary()} class="flex-1" />
        <ScheduleSummaryAction
          summary={summary()}
          operation={props.operation}
        />
      </div>
    )}
  </Show>
);
