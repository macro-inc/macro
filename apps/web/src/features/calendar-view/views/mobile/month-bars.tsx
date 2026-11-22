import { calendarSelectionToEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { getCalendarSupportedRange } from '@app/features/calendar/utils/calendar-supported-range';
import { beginInteraction } from '@app/observability/flow';
import type { DatesSetArg } from '@fullcalendar/core';
import { createElementSize } from '@solid-primitives/resize-observer';
import { addDays } from 'date-fns';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  type CalendarFocusTarget,
  calendarFocusTargetId,
} from '../../calendar-focus-target';
import { MonthDaySheet } from '../../components/month/MonthDaySheet';
import { MonthGrid } from '../../components/month/MonthGrid';
import { useOpenEventComposer } from '../../components/use-open-event-composer';
import {
  layoutPhoneMonthWeek,
  phoneMonthBarCapacity,
  phoneMonthRange,
} from '../../core/phone-month-layout';
import { createPhoneMonth } from '../../primitives/create-phone-month';

export function PhoneMonthBars(props: {
  range: DatesSetArg | undefined;
  initialDate: Date;
  events: CalendarEvent[];
  showWeekends: boolean;
  timeFormat: CalendarTimeFormat;
  focusTarget?: CalendarFocusTarget;
  onFocusHandled: (requestId: number) => void;
  onSelect: (event: CalendarEvent, element: HTMLElement) => void;
}) {
  const navigation = useCalendarNavigation();
  const [card, setCard] = createSignal<HTMLDivElement>();
  const size = createElementSize(card);
  const openComposer = useOpenEventComposer();
  const [sheetState, setSheetState] = createStore<{
    open: boolean;
    pickedMonth?: string;
  }>({ open: false });
  const setOpen = (open: boolean) => setSheetState('open', open);
  const [sheet, setSheet] = createSignal<HTMLDivElement>();
  const [today, setToday] = createSignal(new Date());
  const timer = setInterval(() => setToday(new Date()), 60_000);
  onCleanup(() => clearInterval(timer));
  const currentMonth = () =>
    props.range?.view.currentStart ?? props.initialDate;
  const monthKey = () =>
    `${currentMonth().getFullYear()}-${currentMonth().getMonth()}`;
  const range = createMemo(() => phoneMonthRange(currentMonth()));
  const month = createPhoneMonth({
    start: () => range().start,
    month: currentMonth,
    initialDate: props.initialDate,
    dayCount: () => range().dayCount,
    events: () => props.events,
    showWeekends: () => props.showWeekends,
    focusDate: () => props.focusTarget?.date,
  });
  const capacity = () => phoneMonthBarCapacity(size.height, range().weekCount);
  const weeks = createMemo(() => {
    const bounds = range();
    const columns = props.showWeekends ? 7 : 5;
    const days = month.days();
    return Array.from({ length: bounds.weekCount }, (_, index) => {
      const week = days.slice(index * columns, (index + 1) * columns);
      return layoutPhoneMonthWeek(week, capacity());
    });
  });
  const supported = getCalendarSupportedRange();
  const selectEvent = (event: CalendarEvent, element: HTMLElement) => {
    batch(() => {
      setOpen(false);
      props.onSelect(event, element);
    });
  };
  const pick = (date: Date) => {
    const interaction = beginInteraction('calendar.month.day.open');
    try {
      month.pick(date);
      setSheetState({ open: true, pickedMonth: monthKey() });
    } finally {
      interaction.end();
    }
  };
  let handledFocus: number | undefined;
  let navigatedFocus: string | undefined;
  createEffect(() => {
    const target = props.focusTarget;
    if (!target || target.requestId === handledFocus) return;
    const bounds = range();
    if (target.date < bounds.start || target.date >= bounds.end) {
      const key = `${target.requestId}:${bounds.start.getTime()}`;
      if (navigatedFocus !== key) {
        navigatedFocus = key;
        setOpen(false);
        navigation.navigateToDate(target.date);
      }
      return;
    }
    pick(target.date);
    const root = sheet();
    const event = month
      .events()
      .find((event) => event.id === calendarFocusTargetId(target));
    const row = Array.from(
      root?.querySelectorAll<HTMLElement>('[data-calendar-month-event]') ?? []
    ).find((element) => element.dataset.calendarMonthEvent === event?.id);
    if (!event || !row?.isConnected) return;
    handledFocus = target.requestId;
    row.scrollIntoView({ block: 'nearest' });
    selectEvent(event, row);
    props.onFocusHandled(target.requestId);
  });
  const openDay = () => {
    const date = month.selected();
    setOpen(false);
    batch(() => {
      navigation.gotoDate(date);
      navigation.changeView('timeGridDay');
    });
  };
  const createOnDay = () => {
    const date = month.selected();
    setOpen(false);
    const interaction = beginInteraction('calendar.month.create');
    try {
      openComposer({
        initialValues: calendarSelectionToEditorInitialValues(
          { start: date, end: addDays(date, 1), allDay: true },
          true
        ),
      });
    } finally {
      interaction.end();
    }
  };
  return (
    <div class="phone-month absolute inset-0 z-10 flex min-h-0 flex-col">
      <MonthGrid
        weeks={weeks()}
        month={currentMonth()}
        today={today()}
        selected={
          sheetState.pickedMonth === monthKey() ? month.selected() : undefined
        }
        capacity={capacity()}
        cardRef={setCard}
        isSupported={(date) => date >= supported.start && date < supported.end}
        onPick={pick}
      />
      <MonthDaySheet
        open={sheetState.open}
        date={month.selected()}
        events={month.events()}
        timeFormat={props.timeFormat}
        onOpenChange={setOpen}
        onOpenDay={openDay}
        onCreate={createOnDay}
        onSelect={selectEvent}
        ref={setSheet}
      />
    </div>
  );
}
