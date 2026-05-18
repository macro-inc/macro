import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { endOfDay } from 'date-fns/endOfDay';
import { isAfter } from 'date-fns/isAfter';
import { isBefore } from 'date-fns/isBefore';
import { startOfDay } from 'date-fns/startOfDay';
import { createEffect, createSignal, For, on, Show } from 'solid-js';

export type DatePickerUIProps = {
  value: Date;
  onChange: (date: Date) => void;
  disablePriorToDate?: Date;
  disableAfterDate?: Date;
  showTimePicker?: boolean;
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

export function DatePickerUI(props: DatePickerUIProps) {
  const [displayMonth, setDisplayMonth] = createSignal(props.value.getMonth());
  const [displayYear, setDisplayYear] = createSignal(props.value.getFullYear());
  const [pickerMode, setPickerMode] = createSignal<PickerMode>('calendar');
  const [selectedDate, setSelectedDate] = createSignal(props.value);
  const [hour, setHour] = createSignal(props.value.getHours() % 12 || 12);
  const [hourDisplay, setHourDisplay] = createSignal(
    (props.value.getHours() % 12 || 12).toString()
  );
  const [minute, setMinute] = createSignal(props.value.getMinutes());
  const [minuteDisplay, setMinuteDisplay] = createSignal(
    props.value.getMinutes().toString().padStart(2, '0')
  );
  const [period, setPeriod] = createSignal<'AM' | 'PM'>(
    props.value.getHours() >= 12 ? 'PM' : 'AM'
  );

  createEffect(
    on(
      () => props.value,
      (value) => {
        setSelectedDate(value);
        const h = value.getHours() % 12 || 12;
        setHour(h);
        setHourDisplay(h.toString());
        const m = value.getMinutes();
        setMinute(m);
        setMinuteDisplay(m.toString().padStart(2, '0'));
        setPeriod(value.getHours() >= 12 ? 'PM' : 'AM');
      },
      { defer: true }
    )
  );

  const getHour24 = () => {
    const h = hour();
    const p = period();
    if (p === 'AM') return h === 12 ? 0 : h;
    return h === 12 ? 12 : h + 12;
  };

  const buildDateWithTime = (base: Date) => {
    if (!props.showTimePicker) return base;
    const d = new Date(base);
    d.setHours(getHour24(), minute(), 0, 0);
    return d;
  };

  const isTimeInPast = () => {
    if (!props.disablePriorToDate) return false;
    return isBefore(
      buildDateWithTime(selectedDate()),
      props.disablePriorToDate
    );
  };

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

  const getDateForDay = (day: number) => {
    return new Date(displayYear(), displayMonth(), day);
  };

  const handleDateClick = (day: number) => {
    if (props.showTimePicker) {
      setSelectedDate(getDateForDay(day));
      return;
    }
    props.onChange(getDateForDay(day));
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
    const val = props.showTimePicker ? selectedDate() : props.value;
    return (
      displayYear() === val.getFullYear() &&
      displayMonth() === val.getMonth() &&
      day === val.getDate()
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
    <div class="p-4 w-80">
      <Show when={pickerMode() === 'calendar'}>
        {/* Month/Year header */}
        <div class="flex items-center justify-between mb-3">
          <button
            type="button"
            class="p-1 hover:bg-active transition-colors"
            onClick={handlePrevMonth}
          >
            <CaretLeft class="size-4" />
          </button>

          <button
            type="button"
            class="font-semibold hover:bg-active px-2 py-1 transition-colors"
            onClick={() => setPickerMode('month')}
          >
            {MONTHS[displayMonth()]} {displayYear()}
          </button>

          <button
            type="button"
            class="p-1 hover:bg-active transition-colors"
            onClick={handleNextMonth}
          >
            <CaretRight class="size-4" />
          </button>
        </div>

        {/* Weekday headers */}
        <div class="grid grid-cols-7 gap-1 mb-2">
          <For each={WEEKDAYS}>
            {(day) => (
              <div class="text-center font-medium text-ink-muted">{day}</div>
            )}
          </For>
        </div>

        {/* Calendar days */}
        <div class="grid grid-cols-7 gap-1">
          <For each={calendarDays()}>
            {(day) => (
              <Show when={day !== null} fallback={<div class="h-8" />}>
                <button
                  type="button"
                  class="size-8 transition-colors disabled:opacity-40"
                  classList={{
                    'bg-accent text-surface': isSelected(day!),
                    'hover:bg-active': !isSelected(day!),
                    'ring-1 ring-accent': isToday(day!),
                  }}
                  disabled={
                    (props.disablePriorToDate &&
                      isBefore(
                        getDateForDay(day!),
                        startOfDay(props.disablePriorToDate)
                      )) ||
                    (props.disableAfterDate &&
                      isAfter(
                        getDateForDay(day!),
                        endOfDay(props.disableAfterDate)
                      ))
                  }
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
            type="button"
            class="w-full font-semibold hover:bg-active px-2 py-1 transition-colors text-center"
            onClick={() => setPickerMode('year')}
          >
            {displayYear()}
          </button>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <For each={MONTHS}>
            {(month, index) => (
              <button
                type="button"
                class="px-3 py-2 hover:bg-active transition-colors"
                classList={{
                  'bg-accent text-surface hover:bg-accent':
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
          <div class="font-semibold text-center">Select Year</div>
        </div>

        <div class="h-64 overflow-y-auto">
          <div class="grid grid-cols-3 gap-2">
            <For each={yearOptions()}>
              {(year) => (
                <button
                  type="button"
                  class="px-3 py-2 hover:bg-active transition-colors"
                  classList={{
                    'bg-accent text-surface hover:bg-accent':
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

      <Show when={props.showTimePicker}>
        <div class="border-t border-edge-muted mt-3 pt-3 flex items-center justify-center gap-2">
          <div class="flex items-center gap-1">
            <input
              type="text"
              inputmode="numeric"
              maxLength={2}
              aria-label="Hour"
              class="w-10 text-center bg-active border border-edge-muted p-1 text-sm focus:outline-none focus:border-accent"
              value={hourDisplay()}
              onKeyDown={(e) => {
                if (e.key.length === 1 && !/\d/.test(e.key)) {
                  e.preventDefault();
                }
              }}
              onInput={(e) => {
                const raw = e.currentTarget.value;
                setHourDisplay(raw);
                const val = parseInt(raw);
                if (!isNaN(val) && val >= 1 && val <= 12) {
                  setHour(val);
                }
              }}
              onBlur={() => {
                setHourDisplay(hour().toString());
              }}
            />
            <span class="text-sm font-medium">:</span>
            <input
              type="text"
              inputmode="numeric"
              maxLength={2}
              aria-label="Minute"
              class="w-10 text-center bg-active border border-edge-muted p-1 text-sm focus:outline-none focus:border-accent"
              value={minuteDisplay()}
              onKeyDown={(e) => {
                if (e.key.length === 1 && !/\d/.test(e.key)) {
                  e.preventDefault();
                }
              }}
              onInput={(e) => {
                const raw = e.currentTarget.value;
                setMinuteDisplay(raw);
                const val = parseInt(raw);
                if (!isNaN(val) && val >= 0 && val <= 59) {
                  setMinute(val);
                }
              }}
              onBlur={() => {
                setMinuteDisplay(minute().toString().padStart(2, '0'));
              }}
            />
          </div>
          <div class="flex border border-edge-muted text-sm">
            <button
              type="button"
              class="px-2 py-1 transition-colors"
              classList={{
                'bg-accent text-surface': period() === 'AM',
                'hover:bg-active': period() !== 'AM',
              }}
              onClick={() => setPeriod('AM')}
            >
              AM
            </button>
            <button
              type="button"
              class="px-2 py-1 transition-colors"
              classList={{
                'bg-accent text-surface': period() === 'PM',
                'hover:bg-active': period() !== 'PM',
              }}
              onClick={() => setPeriod('PM')}
            >
              PM
            </button>
          </div>
          <button
            type="button"
            aria-label="Confirm scheduled time"
            class="p-1 bg-surface text-accent hover:bg-active transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={isTimeInPast()}
            onClick={() => props.onChange(buildDateWithTime(selectedDate()))}
          >
            <CheckIcon class="size-4" />
          </button>
        </div>
      </Show>
    </div>
  );
}
