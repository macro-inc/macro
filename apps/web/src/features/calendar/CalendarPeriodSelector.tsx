import { useSidePanel } from '@components/app/side-panel/SidePanel';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Dropdown, Calendar as MiniCalendar } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useCalendarView } from './CalendarViewContext';
import { useFullCalendar } from './fullcalendar-solid';

const CALENDAR_VIEWS = [
  { value: 'dayGridMonth', label: 'Month' },
  { value: 'timeGridWeek', label: 'Week' },
  { value: 'timeGridDay', label: 'Day' },
];

/** Selects the FullCalendar period and provides narrow custom-date navigation. */
export function CalendarPeriodSelector() {
  const calendarView = useCalendarView();
  const calendar = useFullCalendar();
  const sidePanel = useSidePanel();
  const initialDate = new Date();
  const [pickerState, setPickerState] = createStore({
    open: false,
    month: initialDate,
    focusedDay: initialDate,
  });

  const isNarrow = () => sidePanel?.isNarrow() ?? false;
  const currentDate = createMemo(
    () => calendar.dateInfo()?.view.calendar.getDate() ?? initialDate
  );

  const activeView = createMemo(
    () => calendar.dateInfo()?.view.type ?? 'timeGridWeek'
  );

  const highlightedRange = createMemo(() => {
    const dateInfo = calendar.dateInfo();
    return dateInfo?.view.type === 'timeGridWeek'
      ? { end: dateInfo.end, start: dateInfo.start }
      : undefined;
  });

  const changeView = (view: string) => {
    setPickerState('open', false);
    const calendarApi = calendar.api();
    if (calendarApi?.view.type === view) return;
    calendarApi?.changeView(view);
  };

  const syncCustomDatePicker = () => {
    const date = currentDate();
    setPickerState({ month: date, focusedDay: date });
  };

  const navigateCustomDateMonth = (month: Date) => {
    const focusedDay = pickerState.focusedDay;
    const targetDate =
      focusedDay.getFullYear() === month.getFullYear() &&
      focusedDay.getMonth() === month.getMonth()
        ? focusedDay
        : month;
    setPickerState({ month, focusedDay: targetDate });
  };

  const selectCustomDate = (date: Date | null) => {
    if (!date) return;
    setPickerState({ month: date, focusedDay: date, open: false });
    calendar.api()?.gotoDate(date);
  };

  return (
    <Dropdown
      open={pickerState.open}
      onOpenChange={(open) => setPickerState('open', open)}
      placement="bottom-end"
    >
      <Dropdown.Trigger
        depth={2}
        aria-label="Choose calendar view"
        class="h-7 shrink-0 gap-1 rounded-lg border-edge-muted bg-panel px-2 text-xs font-medium text-ink"
      >
        {CALENDAR_VIEWS.find((view) => view.value === activeView())?.label ??
          'Week'}
        <CaretDownIcon class="size-3 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-36">
        <Dropdown.Group>
          <Dropdown.RadioGroup value={activeView()} onChange={changeView}>
            <For each={CALENDAR_VIEWS}>
              {(view) => (
                <Dropdown.RadioItem closeOnSelect value={view.value}>
                  <span class="flex-1">{view.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
        <Show when={isNarrow()}>
          <Dropdown.Group>
            <Dropdown.Sub
              onOpenChange={(open) => {
                if (open) syncCustomDatePicker();
              }}
            >
              <Dropdown.SubTrigger>
                <CalendarIcon class="size-3.5 text-ink-muted" />
                <span class="flex-1">Custom date…</span>
                <CaretRightIcon class="size-3 text-ink-muted" />
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="w-72 max-w-[calc(100vw-1rem)]">
                <Dropdown.Group class="p-3">
                  <MiniCalendar
                    required
                    fixedWeeks
                    startOfWeek={calendarView.displaySettings.weekStartsOn}
                    value={currentDate()}
                    month={pickerState.month}
                    focusedDay={pickerState.focusedDay}
                    highlightedRange={highlightedRange()}
                    onMonthChange={navigateCustomDateMonth}
                    onFocusedDayChange={(date) =>
                      setPickerState('focusedDay', date)
                    }
                    onValueChange={selectCustomDate}
                  />
                </Dropdown.Group>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
