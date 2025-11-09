import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import clickOutside from '@core/directive/clickOutside';
import CaretLeft from '@icon/regular/caret-left.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import { createSignal, For, Show } from 'solid-js';

false && floatWithElement;
false && clickOutside;

export type DatePickerProps = {
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
  anchorRef: HTMLElement;
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type PickerMode = 'calendar' | 'month' | 'year';

export function DatePicker(props: DatePickerProps) {
  const [displayMonth, setDisplayMonth] = createSignal(props.value.getMonth());
  const [displayYear, setDisplayYear] = createSignal(props.value.getFullYear());
  const [pickerMode, setPickerMode] = createSignal<PickerMode>('calendar');

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    if (displayMonth() === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear() - 1);
    } else {
      setDisplayMonth(displayMonth() - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth() === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear() + 1);
    } else {
      setDisplayMonth(displayMonth() + 1);
    }
  };

  const handleDateClick = (day: number) => {
    const newDate = new Date(displayYear(), displayMonth(), day);
    props.onChange(newDate);
  };

  const _handleQuickSelect = (date: Date) => {
    props.onChange(date);
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      displayYear() === today.getFullYear() &&
      displayMonth() === today.getMonth() &&
      day === today.getDate()
    );
  };

  const isSelected = (day: number) => {
    return (
      displayYear() === props.value.getFullYear() &&
      displayMonth() === props.value.getMonth() &&
      day === props.value.getDate()
    );
  };

  const daysInMonth = () => getDaysInMonth(displayYear(), displayMonth());
  const firstDay = () => getFirstDayOfMonth(displayYear(), displayMonth());

  // Generate calendar days
  const calendarDays = () => {
    const days: (number | null)[] = [];

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay(); i++) {
      days.push(null);
    }

    // Add days of the month
    for (let i = 1; i <= daysInMonth(); i++) {
      days.push(i);
    }

    return days;
  };

  // Quick date options
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const handleYearSelect = (year: number) => {
    setDisplayYear(year);
    setPickerMode('month');
  };

  const handleMonthSelect = (month: number) => {
    setDisplayMonth(month);
    setPickerMode('calendar');
  };

  // Generate years for year picker (current year ± 50 years)
  const yearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let i = currentYear - 50; i <= currentYear + 50; i++) {
      years.push(i);
    }
    return years;
  };

  return (
    <div
      class="absolute z-action-menu bg-dialog ring-1 ring-edge shadow-xl p-4 w-80 font-mono"
      use:floatWithElement={{ element: () => props.anchorRef }}
      use:clickOutside={props.onClose}
    >
      <Show when={pickerMode() === 'calendar'}>
        {/* Month/Year header */}
        <div class="flex items-center justify-between mb-3">
          <button
            class="p-1 hover:bg-active transition-colors"
            onClick={handlePrevMonth}
          >
            <CaretLeft class="w-4 h-4" />
          </button>

          <button
            class="font-semibold text-sm hover:bg-active px-2 py-1 transition-colors"
            onClick={() => setPickerMode('month')}
          >
            {MONTHS[displayMonth()]} {displayYear()}
          </button>

          <button
            class="p-1 hover:bg-active transition-colors"
            onClick={handleNextMonth}
          >
            <CaretRight class="w-4 h-4" />
          </button>
        </div>

        {/* Weekday headers */}
        <div class="grid grid-cols-7 gap-1 mb-2">
          <For each={WEEKDAYS}>
            {(day) => (
              <div class="text-center text-xs font-medium text-ink-muted">
                {day}
              </div>
            )}
          </For>
        </div>

        {/* Calendar days */}
        <div class="grid grid-cols-7 gap-1">
          <For each={calendarDays()}>
            {(day) => (
              <Show when={day !== null} fallback={<div class="h-8" />}>
                <button
                  class="h-8 w-8 text-sm hover:bg-active transition-colors"
                  classList={{
                    'bg-accent text-dialog hover:bg-accent-ink': isSelected(
                      day!
                    ),
                    'ring-1 ring-accent': isToday(day!),
                  }}
                  onClick={() => handleDateClick(day!)}
                >
                  {day}
                </button>
              </Show>
            )}
          </For>
        </div>
      </Show>

      <Show when={pickerMode() === 'month'}>
        {/* Month picker */}
        <div class="mb-3">
          <button
            class="w-full font-semibold text-sm hover:bg-active px-2 py-1 transition-colors text-center"
            onClick={() => setPickerMode('year')}
          >
            {displayYear()}
          </button>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <For each={MONTHS}>
            {(month, index) => (
              <button
                class="px-3 py-2 text-sm hover:bg-active transition-colors"
                classList={{
                  'bg-accent text-dialog hover:bg-accent-ink':
                    displayMonth() === index(),
                }}
                onClick={() => handleMonthSelect(index())}
              >
                {month.slice(0, 3)}
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={pickerMode() === 'year'}>
        {/* Year picker */}
        <div class="mb-3">
          <div class="font-semibold text-sm text-center">Select Year</div>
        </div>

        <div class="h-64 overflow-y-auto">
          <div class="grid grid-cols-3 gap-2">
            <For each={yearOptions()}>
              {(year) => (
                <button
                  class="px-3 py-2 text-sm hover:bg-active transition-colors"
                  classList={{
                    'bg-accent text-dialog hover:bg-accent-ink':
                      displayYear() === year,
                  }}
                  onClick={() => handleYearSelect(year)}
                >
                  {year}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
