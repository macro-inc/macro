import { DateSelector } from '@block-email/component/date-selector';
import { isMobile } from '@core/mobile/isMobile';
import ClockIcon from '@icon/regular/clock.svg';
import IconX from '@icon/regular/x.svg';
import { Button, Tooltip } from '@ui';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { Show, type VoidComponent } from 'solid-js';

interface EmailDateSelectorProps {
  sendTime?: Date | null;
  onSendTimeChange?: (date: Date | null) => void;
  /** Only show the clock icon, no date text or clear button */
  compact?: boolean;
  /** Render content inline instead of in a portal */
  disablePortal?: boolean;
  /** Disable the schedule button */
  disabled?: boolean;
}
export const EmailDateSelector: VoidComponent<EmailDateSelectorProps> = (
  props
) => {
  const isCompact = () => props.compact || isMobile();

  return (
    <DateSelector
      selectedDate={props.sendTime}
      onSelectDate={props.onSendTimeChange}
      disabled={props.disabled}
      disablePriorToDate={new Date()}
      disableAfterDate={addYears(new Date(), 1)}
      disablePortal={props.disablePortal}
      trigger={(state) => {
        const formattedDate = () =>
          state.selectedDate
            ? format(state.selectedDate, 'MMM d, yyyy  h:mm a')
            : undefined;
        const showExpanded = () => !isCompact() && !!formattedDate();

        return (
          <Show
            when={showExpanded()}
            fallback={
              <Tooltip
                label={
                  state.selectedDate
                    ? `Scheduled for ${formattedDate()}`
                    : 'Schedule this email'
                }
              >
                <Button size="icon-sm" disabled={props.disabled}>
                  <ClockIcon class={state.selectedDate ? 'text-accent' : ''} />
                </Button>
              </Tooltip>
            }
          >
            <Button
              size="icon-sm"
              disabled={props.disabled}
              class="size-auto gap-1 bg-accent/20 text-accent hover:bg-accent/15! hover:text-accent!"
            >
              <ClockIcon />
              <span class="text-sm">{formattedDate()}</span>
              <Tooltip label="Clear">
                <div
                  tabIndex={0}
                  class="hover:bg-accent/30"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={() => props.onSendTimeChange?.(null)}
                >
                  <IconX class="size-5" />
                </div>
              </Tooltip>
            </Button>
          </Show>
        );
      }}
    />
  );
};
