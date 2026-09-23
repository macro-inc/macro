import type { EmailScheduleState } from '@app/features/email-compose/primitives/email-send-schedule';
import { format } from 'date-fns/format';
import { Show, type VoidComponent } from 'solid-js';

interface EmailScheduleSummaryProps {
  state: EmailScheduleState;
  operation: 'idle' | 'committing' | 'updating' | 'cancelling';
  onSelectTime: (date: Date | null) => void | boolean;
  onCancelSchedule: () => Promise<boolean>;
}

export const EmailScheduleSummary: VoidComponent<EmailScheduleSummaryProps> = (
  props
) => {
  const summary = () => {
    const state = props.state;
    if (state.type === 'editing') {
      if (state.intent.type === 'immediate') return undefined;
      return {
        label: `Send later: ${format(state.intent.sendTime, "MMM d 'at' h:mm a")}`,
        detail: undefined,
        actionLabel: 'Cancel',
        accessibleActionLabel: 'Cancel send time',
        action: () => props.onSelectTime(null),
      };
    }
    if (state.proposedTime) {
      return {
        label: `Scheduled for ${format(state.confirmedTime, "MMM d 'at' h:mm a")}`,
        detail: `Update to ${format(state.proposedTime, "MMM d 'at' h:mm a")}; original remains active until Update succeeds`,
        actionLabel: 'Cancel change',
        accessibleActionLabel: 'Cancel schedule change',
        action: () => props.onSelectTime(null),
      };
    }
    return {
      label: `Scheduled for ${format(state.confirmedTime, "MMM d 'at' h:mm a")}`,
      detail: undefined,
      actionLabel: 'Cancel',
      accessibleActionLabel: 'Cancel scheduled send',
      action: () => void props.onCancelSchedule(),
    };
  };

  return (
    <Show when={summary()}>
      {(value) => (
        <div
          data-testid="schedule-summary"
          class="mr-auto flex min-w-32 flex-1 items-center gap-2 pr-2 text-xs"
        >
          <div
            role="status"
            data-testid="schedule-summary-label"
            class="min-w-0 flex-1 leading-tight"
            title={
              value().detail
                ? `${value().label}. ${value().detail}`
                : value().label
            }
          >
            <div class="truncate text-ink-muted">{value().label}</div>
            <Show when={value().detail}>
              {(detail) => (
                <div class="truncate text-ink-extra-muted">{detail()}</div>
              )}
            </Show>
          </div>
          <button
            type="button"
            class="min-h-8 shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/10 disabled:text-ink-extra-muted"
            aria-label={value().accessibleActionLabel}
            disabled={props.operation !== 'idle'}
            onClick={value().action}
          >
            {props.operation === 'cancelling'
              ? 'Cancelling…'
              : value().actionLabel}
          </button>
        </div>
      )}
    </Show>
  );
};
