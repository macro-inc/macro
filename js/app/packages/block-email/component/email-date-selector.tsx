import ClockIcon from '@phosphor-icons/core/assets/regular/clock.svg';
import { DateSelector } from '@block-email/component/date-selector';
import { Tooltip } from '@core/component/Tooltip';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { Show, type VoidComponent } from 'solid-js';
import IconX from '@icon/regular/x.svg';
import { Button } from '@ui';
import { isMobile } from '@core/mobile/isMobile';
import { cn } from '@ui';

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
        const formattedDate = () => {
          if (!state.selectedDate) return;
          return format(state.selectedDate, 'MMM d, yyyy  h:mm a');
        };
        const showExpanded = () => !isCompact() && !!formattedDate();
        return (
          <Tooltip
            tooltip={
              state.selectedDate
                ? `Scheduled for ${formattedDate()}`
                : 'Schedule this email'
            }
            hide={showExpanded()}
          >
            <Button
              size="icon-sm"
              disabled={props.disabled}
              class={cn(
                showExpanded() &&
                  'size-auto gap-1 bg-accent/20 text-accent-ink hover:bg-accent/15! hover:text-accent-ink!'
              )}
            >
              <ClockIcon
                class={state.selectedDate && isCompact() ? 'text-accent' : ''}
              />
              <Show when={showExpanded()}>
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
