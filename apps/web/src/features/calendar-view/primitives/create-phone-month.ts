import { agendaEventsByDay } from '@app/features/calendar/primitives/agenda-window';
import type { CalendarEvent } from '@app/features/calendar/types';
import { isSameLocalDate } from '@app/features/calendar/utils/calendar-date';
import { type Accessor, createMemo, createSignal } from 'solid-js';

type MonthEvent = Pick<
  CalendarEvent,
  'id' | 'start' | 'end' | 'allDay' | 'isCancelled'
>;
const monthKey = (date: Date | undefined) =>
  date ? `${date.getFullYear()}-${date.getMonth()}` : '';

export function createPhoneMonth<T extends MonthEvent>(options: {
  start: Accessor<Date>;
  month: Accessor<Date>;
  initialDate: Date;
  events: Accessor<readonly T[]>;
  showWeekends: Accessor<boolean>;
  focusDate: Accessor<Date | undefined>;
  dayCount: Accessor<number>;
}) {
  const [picked, setPicked] = createSignal<{ date: Date; month: string }>();
  const days = createMemo(() => {
    const start = options.start();
    return agendaEventsByDay(options.events(), start, options.dayCount());
  });
  const visibleDays = createMemo(() =>
    days().filter(
      (day) =>
        options.showWeekends() ||
        (day.date.getDay() !== 0 && day.date.getDay() !== 6)
    )
  );
  const isVisible = (date: Date) =>
    visibleDays().some((day) => isSameLocalDate(day.date, date));
  const selected = () => {
    const focus = options.focusDate();
    // A linked hidden-weekend event can still open in the day sheet.
    if (focus && days().some((day) => isSameLocalDate(day.date, focus)))
      return focus;
    const currentMonth = monthKey(options.month());
    const choice = picked();
    if (choice?.month === currentMonth && isVisible(choice.date))
      return choice.date;
    if (
      monthKey(options.initialDate) === currentMonth &&
      isVisible(options.initialDate)
    )
      return options.initialDate;
    return (
      visibleDays().find((day) => monthKey(day.date) === currentMonth)?.date ??
      options.month() ??
      options.initialDate
    );
  };
  return {
    days: visibleDays,
    selected,
    events: () =>
      days().find((day) => isSameLocalDate(day.date, selected()))?.events ?? [],
    pick: (date: Date) => setPicked({ date, month: monthKey(options.month()) }),
  };
}
