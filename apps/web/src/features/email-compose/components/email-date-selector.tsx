import type { EmailScheduleState } from '@app/features/email-compose/primitives/email-send-schedule';
import ClockIcon from '@phosphor/clock.svg';
import { buttonClasses, cn, Tooltip } from '@ui';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { type JSX, Show, type VoidComponent } from 'solid-js';
import { DateSelector } from './date-selector';

interface EmailDateSelectorProps {
  state: EmailScheduleState;
  selectedTime?: Date;
  mobile: boolean;
  onSelectTime?: (date: Date | null) => void | boolean;
  onCancelSchedule?: () => Promise<boolean>;
  operation?: 'idle' | 'committing' | 'updating' | 'cancelling';
  /** Only show the clock icon, no date text. */
  compact?: boolean;
  /** Render content inline instead of in a portal. */
  disablePortal?: boolean;
  disabled?: boolean;
  trigger?: (state: {
    selectedDate: Date | null;
    formattedDate: string | undefined;
  }) => JSX.Element;
}

export const EmailDateSelector: VoidComponent<EmailDateSelectorProps> = (
  props
) => {
  const isCompact = () => props.compact || props.mobile;
  const formattedDate = () =>
    props.selectedTime
      ? format(props.selectedTime, 'MMM d, yyyy  h:mm a')
      : undefined;
  const isConfirmed = () => props.state.type === 'scheduled';
  const hasProposal = () =>
    props.state.type === 'scheduled' && !!props.state.proposedTime;
  const accessibleLabel = () => {
    const label = formattedDate();
    if (!label) return 'Choose send time';
    if (!isConfirmed())
      return `Will send ${label} after you choose Schedule send.`;
    if (hasProposal()) {
      const confirmed = (
        props.state as Extract<EmailScheduleState, { type: 'scheduled' }>
      ).confirmedTime;
      return `Proposed send time ${label}. The email remains scheduled for ${format(confirmed, 'MMM d, yyyy  h:mm a')} until you choose Update schedule.`;
    }
    return `Scheduled for ${label}. Open to propose a new time or cancel the schedule.`;
  };
  const clearable = () =>
    (props.state.type === 'editing' && props.state.intent.type === 'later') ||
    hasProposal();

  return (
    <Tooltip label={accessibleLabel()} class="min-w-0 max-w-full">
      <div class="min-w-0 max-w-full">
        <DateSelector
          selectedDate={props.selectedTime}
          onSelectDate={props.onSelectTime}
          disabled={props.disabled}
          disablePriorToDate={new Date()}
          disableAfterDate={addYears(new Date(), 1)}
          disablePortal={props.disablePortal}
          triggerLabel={accessibleLabel()}
          clearable={clearable()}
          clearLabel={hasProposal() ? 'Discard proposed time' : 'Clear time'}
          currentLabel={
            hasProposal()
              ? 'Proposed:'
              : isConfirmed()
                ? 'Scheduled:'
                : 'Will send:'
          }
          footer={
            <Show when={isConfirmed()}>
              <div class="flex flex-col gap-2">
                <p class="px-1 text-xs text-ink-muted">
                  {hasProposal()
                    ? 'The original schedule stays active until Update schedule succeeds.'
                    : 'Cancel the schedule before editing the message.'}
                </p>
                <button
                  type="button"
                  class="rounded-lg px-2 py-1.5 text-left text-sm text-failure hover:bg-hover disabled:text-ink-extra-muted"
                  disabled={props.operation !== 'idle'}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void props.onCancelSchedule?.()}
                >
                  {props.operation === 'cancelling'
                    ? 'Cancelling schedule…'
                    : 'Cancel schedule'}
                </button>
              </div>
            </Show>
          }
          triggerClass={cn(
            buttonClasses({ size: 'icon-composer' }),
            props.selectedTime &&
              !isCompact() &&
              'min-w-0 max-w-full shrink gap-1 aspect-auto! bg-accent/20 text-accent hover:bg-accent/15! hover:text-accent! not-touch:min-w-[33.75px] not-touch:w-auto! not-touch:px-2'
          )}
          trigger={(state) => {
            const selectedLabel = () =>
              state.selectedDate
                ? format(state.selectedDate, 'MMM d, yyyy  h:mm a')
                : undefined;
            const showExpanded = () => !isCompact() && !!selectedLabel();

            if (props.trigger) {
              return props.trigger({
                selectedDate: state.selectedDate,
                formattedDate: selectedLabel(),
              });
            }

            return (
              <div class="flex min-w-0 items-center gap-1">
                <ClockIcon class={state.selectedDate ? 'text-accent' : ''} />
                <Show when={showExpanded()}>
                  <span class="min-w-0 truncate text-sm">
                    {selectedLabel()}
                  </span>
                </Show>
              </div>
            );
          }}
        />
      </div>
    </Tooltip>
  );
};
