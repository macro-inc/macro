import ClockIcon from '@phosphor-icons/core/assets/regular/clock.svg';
import { DateSelector } from '@block-email/component/date-selector';
import { Tooltip } from '@core/component/Tooltip';
import { cn } from '@ui/utils/classname';
import { format } from 'date-fns/format';
import type { VoidComponent } from 'solid-js';

interface EmailDateSelectorProps {
  sendTime?: Date | null;
  onSendTimeChange?: (date: Date | null) => void;
}
export const EmailDateSelector: VoidComponent<EmailDateSelectorProps> = (
  props
) => {
  return (
    <DateSelector
      selectedDate={props.sendTime}
      onSelectDate={props.onSendTimeChange}
      trigger={(state) => {
        const formattedDate = () => {
          if (!state.selectedDate) return;
          return format(state.selectedDate, "MMMM d, yyyy 'at' h:mm a");
        };
        return (
          <Tooltip
            tooltip={
              state.selectedDate
                ? `Scheduled for ${formattedDate()}`
                : 'Schedule this email'
            }
          >
            <div
              class={cn(
                'aspect-square p-1 hover:bg-surface-4 group-data-[expanded]/date-selector-trigger:bg-surface-4',
                state.selectedDate &&
                  'bg-accent/20 text-accent-ink hover:bg-accent/15 group-data-[expanded]/date-selector-trigger:bg-accent/20'
              )}
            >
              <ClockIcon class="size-5" />
            </div>
          </Tooltip>
        );
      }}
    />
  );
};
