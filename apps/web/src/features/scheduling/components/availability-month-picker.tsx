import CalendarBlank from '@icon/system/regular/calendar-blank.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Calendar as MiniCalendar } from '@ui';
import { format, parseISO } from 'date-fns';
import { createSignal } from 'solid-js';

export function AvailabilityMonthPicker(props: {
  date: string;
  disabled?: boolean;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [month, setMonth] = createSignal(parseISO(props.date));
  const [focusedDay, setFocusedDay] = createSignal(parseISO(props.date));
  const label = () => format(parseISO(props.date), 'MMMM yyyy');
  const changeOpen = (value: boolean) => {
    if (value) {
      const date = parseISO(props.date);
      setMonth(date);
      setFocusedDay(date);
    }
    setOpen(value);
  };
  return (
    <Popover
      open={open()}
      onOpenChange={changeOpen}
      placement="bottom-start"
      gutter={8}
      modal={false}
      fitViewport
    >
      <Popover.Trigger
        as={Button}
        ref={setTrigger}
        variant="ghost"
        size="sm"
        aria-label="Choose availability month"
        disabled={props.disabled}
      >
        <CalendarBlank class="size-3.5" />
        {label()}
      </Popover.Trigger>
      <Popover.Portal
        mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <Popover.Content class="portal-scope menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-4 outline-none">
          <Popover.Title class="sr-only">
            Choose availability month
          </Popover.Title>
          <MiniCalendar
            required
            fixedWeeks
            startOfWeek={0}
            value={parseISO(props.date)}
            month={month()}
            focusedDay={focusedDay()}
            onMonthChange={(value) => {
              setMonth(value);
              setFocusedDay(value);
            }}
            onFocusedDayChange={setFocusedDay}
            onValueChange={(value) => {
              if (!value) return;
              props.onChange(format(value, 'yyyy-MM-dd'));
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
