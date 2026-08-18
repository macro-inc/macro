import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import { SidePanel, useSidePanel } from '@components/app/side-panel/SidePanel';
import { Calendar as MiniCalendar } from '@ui';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';

function CalendarMiniCalendarSidePanelSection() {
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const initialDate = new Date();
  const [focusedDay, setFocusedDay] = createSignal(initialDate);

  const currentDate = createMemo(
    () => calendarPager.activeDateInfo()?.view.calendar.getDate() ?? initialDate
  );

  const highlightedRange = createMemo(() => {
    const dateInfo = calendarPager.activeDateInfo();
    return dateInfo?.view.type === 'timeGridWeek'
      ? { end: dateInfo.end, start: dateInfo.start }
      : undefined;
  });

  const selectDate = (date: Date | null) => {
    if (!date) return;
    setFocusedDay(date);
    calendarPager.gotoDate(date);
  };

  const navigateMonth = (month: Date) => {
    const focused = focusedDay();
    const targetDate =
      focused.getFullYear() === month.getFullYear() &&
      focused.getMonth() === month.getMonth()
        ? focused
        : month;
    setFocusedDay(targetDate);
    calendarPager.gotoDate(targetDate);
  };

  createEffect(on(currentDate, setFocusedDay));

  return (
    <SidePanel.Section
      id="calendar-mini-calendar"
      title="Calendar"
      order={10}
      defaultOpen
    >
      <MiniCalendar
        required
        fixedWeeks
        startOfWeek={calendarView.displaySettings.weekStartsOn}
        value={currentDate()}
        month={currentDate()}
        focusedDay={focusedDay()}
        highlightedRange={highlightedRange()}
        onMonthChange={navigateMonth}
        onFocusedDayChange={setFocusedDay}
        onValueChange={selectDate}
      />
    </SidePanel.Section>
  );
}

function CalendarSourcesSidePanelSection() {
  const calendarView = useCalendarView();

  return (
    <Show when={calendarView.sources().length > 1}>
      <SidePanel.Section
        id="calendar-controls"
        title="Calendars"
        order={20}
        defaultOpen
      >
        <SourceControls
          sources={calendarView.sources()}
          isVisible={calendarView.isSourceVisible}
          onVisibilityChange={calendarView.setSourceVisibility}
        />
      </SidePanel.Section>
    </Show>
  );
}

/** Registers the calendar's contextual right-side panel sections. */
export function SidePanelSections() {
  const sidePanel = useSidePanel();

  return (
    <Show when={!sidePanel?.isNarrow()}>
      <CalendarMiniCalendarSidePanelSection />
      <CalendarSourcesSidePanelSection />
    </Show>
  );
}
