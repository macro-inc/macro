import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import { Popover } from '@kobalte/core/popover';
import { buttonClasses } from '@ui/components/Button';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createSignal } from 'solid-js';
import { dateLabelFormatter } from './time-input';

interface DateFieldProps {
  id?: string;
  subject: string;
  label: 'Start' | 'End';
  /** `YYYY-MM-DD`, or empty. */
  date: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placement: 'bottom-start' | 'bottom-end';
}

/** One end's day: a button showing it that opens a month calendar. */
export function DateField(props: DateFieldProps) {
  const [open, setOpen] = createSignal(false);
  const selectedDate = () => parseLocalDate(props.date);

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={(nextOpen) => setOpen(!props.disabled && nextOpen)}
      placement={props.placement}
      gutter={4}
      flip
      slide
    >
      <Popover.Trigger
        id={props.id}
        disabled={props.disabled}
        aria-label={t(
          props.label === 'Start'
            ? 'common.editStartDate'
            : 'common.editEndDate',
          { subject: props.subject }
        )}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        class={buttonClasses({
          variant: 'secondary',
          size: 'xs',
          class: cn(
            // A touch more room after the date than the icon has before it.
            'max-w-40 justify-start pr-2.5',
            props.invalid && 'border-failure text-failure'
          ),
        })}
      >
        <CalendarBlankIcon class="size-3.5 shrink-0" />
        <span class="truncate">
          {selectedDate()
            ? dateLabelFormatter.format(selectedDate())
            : t(
                props.label === 'Start' ? 'common.startDate' : 'common.endDate'
              )}
        </span>
      </Popover.Trigger>

      <ScopedPortal scope="local">
        <Layer depth={3}>
          <Popover.Content
            class="menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-3 menu-open-animation"
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">
              {t(
                props.label === 'Start' ? 'common.startDate' : 'common.endDate'
              )}
            </Popover.Title>
            <Calendar
              required
              fixedWeeks
              value={selectedDate()}
              onValueChange={(date) => {
                if (!date || props.disabled) return;
                props.onChange(formatLocalDate(date));
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Layer>
      </ScopedPortal>
    </Popover>
  );
}
