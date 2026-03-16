import ClockIcon from '@phosphor-icons/core/assets/regular/clock.svg';
import { DateSelector } from '@block-email/component/date-selector';
import { Tooltip } from '@core/component/Tooltip';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { Show, type VoidComponent } from 'solid-js';
import IconX from '@icon/regular/x.svg';
import { Button } from '@ui/components/Button';

interface EmailDateSelectorProps {
  sendTime?: Date | null;
  onSendTimeChange?: (date: Date | null) => void;
  /** Only show the clock icon, no date text or clear button */
  compact?: boolean;
}
export const EmailDateSelector: VoidComponent<EmailDateSelectorProps> = (
  props
) => {
  return (
    <DateSelector
      selectedDate={props.sendTime}
      onSelectDate={props.onSendTimeChange}
      disablePriorToDate={new Date()}
      disableAfterDate={addYears(new Date(), 1)}
      trigger={(state) => {
        const formattedDate = () => {
          if (!state.selectedDate) return;
          return format(state.selectedDate, 'MMM d, yyyy  h:mm a');
        };
        return (
          <Tooltip
            tooltip={
              state.selectedDate
                ? `Scheduled for ${formattedDate()}`
                : 'Schedule this email'
            }
          >
            <Button size="icon-sm">
              <ClockIcon />
              <Show when={!props.compact && formattedDate()}>
                <span class="text-sm">{formattedDate()}</span>
                <Tooltip tooltip="Clear">
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
              </Show>
            </Button>
          </Tooltip>
        );
      }}
    />
  );
};
