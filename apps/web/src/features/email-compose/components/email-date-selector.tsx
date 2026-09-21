import ClockIcon from '@phosphor/clock.svg';
import { buttonClasses, cn, Tooltip } from '@ui';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { type JSX, Show, type VoidComponent } from 'solid-js';
import { DateSelector } from './date-selector';

interface EmailDateSelectorProps {
  sendTime?: Date | null;
  mobile: boolean;
  onSendTimeChange?: (
    date: Date | null
  ) => void | boolean | Promise<void | boolean>;
  /** Only show the clock icon, no date text or clear button */
  compact?: boolean;
  /** Render content inline instead of in a portal */
  disablePortal?: boolean;
  /** Disable the schedule button */
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
    props.sendTime ? format(props.sendTime, 'MMM d, yyyy  h:mm a') : undefined;
  const accessibleLabel = () =>
    formattedDate()
      ? `Scheduled for ${formattedDate()}. Open to reschedule or cancel.`
      : 'Schedule this email';

  return (
    <Tooltip label={accessibleLabel()} class="min-w-0 max-w-full">
      <div class="min-w-0 max-w-full">
        <DateSelector
          selectedDate={props.sendTime}
          onSelectDate={props.onSendTimeChange}
          disabled={props.disabled}
          disablePriorToDate={new Date()}
          disableAfterDate={addYears(new Date(), 1)}
          disablePortal={props.disablePortal}
          triggerLabel={accessibleLabel()}
          clearLabel="Cancel schedule"
          triggerClass={cn(
            buttonClasses({ size: 'icon-composer' }),
            props.sendTime &&
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
