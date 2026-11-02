import { dateLabelFormatter } from '@app/components/date-time-range/time-input';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import { Popover } from '@kobalte/core/popover';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createSignal } from 'solid-js';

interface EventDateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
  portalScope?: 'local';
  appearance?: 'underline' | 'bare';
}

/** Compact calendar date selector used by event date/time ranges. */
export function EventDateField(props: EventDateFieldProps) {
  const [open, setOpen] = createSignal(false);
  const [portalSearchRef, setPortalSearchRef] = createSignal<HTMLDivElement>();
  const selectedDate = () => parseLocalDate(props.value);
  const portalMount = () => {
    if (props.portalScope !== 'local') return undefined;
    return (
      portalSearchRef()?.closest<HTMLElement>('.portal-scope') ?? undefined
    );
  };

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={(next) => setOpen(!props.disabled && next)}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <Popover.Trigger
        aria-label={`${props.label} date`}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid || undefined}
        title={selectedDate() ? dateLabelFormatter.format(selectedDate()) : ''}
        disabled={props.disabled}
        class={cn(
          'flex min-w-0 items-center justify-start gap-1 truncate bg-transparent text-xs font-normal outline-none disabled:cursor-not-allowed',
          props.appearance === 'bare'
            ? 'px-0'
            : 'h-9 border-b border-edge-muted px-1 focus-visible:border-accent',
          props.invalid && 'border-failure',
          props.class
        )}
      >
        <CalendarBlankIcon class="size-3 shrink-0 text-ink-extra-muted" />
        <span class="truncate">
          {selectedDate() ? dateLabelFormatter.format(selectedDate()) : 'Date'}
        </span>
      </Popover.Trigger>

      <div class="hidden" ref={setPortalSearchRef} />
      <Popover.Portal mount={portalMount()}>
        <Layer depth={3}>
          <Popover.Content class="menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-3 menu-open-animation">
            <Popover.Title class="sr-only">
              Choose {props.label.toLowerCase()} date
            </Popover.Title>
            <Calendar
              required
              fixedWeeks
              value={selectedDate()}
              onValueChange={(date) => {
                if (!date) return;
                props.onChange(formatLocalDate(date));
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
