import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import {
  type CorrespondenceParty,
  CorrespondenceSidePanelSection,
  externalParties,
} from '@app/features/correspondence';
import { SidePanel, useSidePanel } from '@components/app/side-panel/SidePanel';
import { useEmail } from '@core/context/user';
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

/**
 * Correspondence for the selected event. Only present while an event is
 * selected, and (via the section itself) only when that event has external
 * parties on it.
 */
function CalendarCorrespondenceSidePanelSection() {
  const calendarView = useCalendarView();
  const currentUserEmail = useEmail();

  // The organizer plus every attendee. `isSelf` marks the connected account
  // on the event; `externalParties` drops it again by address, so a provider
  // that omits the flag still can't leak the user into the panel.
  const parties = createMemo<CorrespondenceParty[]>(() => {
    const event = calendarView.selectedEvent();
    if (!event) return [];

    const participants: CorrespondenceParty[] = [];
    if (event.organizerEmail) {
      participants.push({
        email: event.organizerEmail,
        name: event.organizerName,
      });
    }
    for (const attendee of event.attendees) {
      if (attendee.isSelf) continue;
      participants.push({
        email: attendee.email,
        name: attendee.displayName ?? undefined,
      });
    }
    return externalParties(participants, currentUserEmail());
  });

  return <CorrespondenceSidePanelSection parties={parties()} order={30} />;
}

/** Registers the calendar's contextual right-side panel sections. */
export function SidePanelSections() {
  const sidePanel = useSidePanel();

  return (
    <Show when={!sidePanel?.isNarrow()}>
      <CalendarMiniCalendarSidePanelSection />
      <CalendarSourcesSidePanelSection />
      <CalendarCorrespondenceSidePanelSection />
    </Show>
  );
}
