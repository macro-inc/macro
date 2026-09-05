import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import {
  TEAM_OOO_SOURCE_ID,
  TEAM_OOO_SOURCE_PREFIX,
  type TeamOooWindow,
  useHasTeammates,
  useUpcomingTeamOoo,
} from '@app/features/calendar/hooks/use-team-ooo';
import { SidePanel, useSidePanel } from '@components/app/side-panel/SidePanel';
import { Calendar as MiniCalendar, ToggleSwitch } from '@ui';
import { format } from 'date-fns';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';

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

function CalendarTeamOooSidePanelSection() {
  const calendarView = useCalendarView();
  const hasTeammates = useHasTeammates();
  const isOverlayVisible = () =>
    calendarView.isSourceVisible(TEAM_OOO_SOURCE_ID);
  const setOverlayVisible = (visible: boolean) => {
    calendarView.setSourceVisibility(TEAM_OOO_SOURCE_ID, visible);
    // Hiding the whole overlay closes a teammate event's open details, which
    // the per-source close in setSourceVisibility only does for exact ids.
    if (
      !visible &&
      calendarView
        .selectedEvent()
        ?.calendar.id.startsWith(TEAM_OOO_SOURCE_PREFIX)
    ) {
      calendarView.closeEventDetails();
    }
  };

  return (
    <Show when={hasTeammates()}>
      <SidePanel.Section
        id="calendar-team-ooo"
        title="Team out of office"
        order={30}
        defaultOpen
        actions={
          <span title="Show on calendar">
            <ToggleSwitch
              checked={isOverlayVisible()}
              onChange={setOverlayVisible}
              aria-label="Show team out of office on the calendar"
            />
          </span>
        }
      >
        <TeamOooUpcomingList />
      </SidePanel.Section>
    </Show>
  );
}

const UPCOMING_SHOWN_MAX = 10;

function windowDateLabel(window: TeamOooWindow): string {
  // The exclusive end pulled back a moment lands on the last covered day for
  // both all-day dates and timed spans ending at midnight.
  const lastDay = new Date(window.end.getTime() - 1);
  return window.start.toDateString() === lastDay.toDateString()
    ? format(window.start, 'EEE, MMM d')
    : `${format(window.start, 'MMM d')} – ${format(lastDay, 'MMM d')}`;
}

function TeamOooSkeleton() {
  return (
    <div aria-hidden="true" class="flex flex-col gap-0.5">
      <For each={[0, 1, 2]}>
        {() => (
          <div class="skeleton-shimmer h-8 w-full rounded-lg bg-skeleton" />
        )}
      </For>
    </div>
  );
}

function TeamOooUpcomingList() {
  const calendarPager = useCalendarPager();
  const upcoming = useUpcomingTeamOoo();
  const windows = upcoming.windows;

  return (
    <div class="flex flex-col gap-0.5">
      <Switch>
        <Match when={upcoming.isPending()}>
          <TeamOooSkeleton />
        </Match>
        <Match when={upcoming.isError()}>
          <span class="px-2 py-1 text-xs text-ink-muted">
            Couldn't load time off
          </span>
        </Match>
        <Match when={windows().length === 0}>
          <span class="px-2 py-1 text-xs text-ink-muted">
            No time off in the next 90 days
          </span>
        </Match>
        <Match when={windows().length > 0}>
          <For each={windows().slice(0, UPCOMING_SHOWN_MAX)}>
            {(window) => (
              <button
                type="button"
                class="flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-xs hover:bg-hover"
                onClick={() => calendarPager.gotoDate(window.start)}
              >
                <span class="flex w-full items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate text-ink">
                    {window.name}
                  </span>
                  <span class="shrink-0 text-ink-muted">
                    {windowDateLabel(window)}
                  </span>
                </span>
                <Show when={window.title}>
                  <span class="w-full truncate text-ink-muted">
                    {window.title}
                  </span>
                </Show>
              </button>
            )}
          </For>
          <Show when={windows().length > UPCOMING_SHOWN_MAX}>
            <span class="px-2 py-1 text-xs text-ink-muted">
              +{windows().length - UPCOMING_SHOWN_MAX} more
            </span>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

/** Registers the calendar's contextual right-side panel sections. */
export function SidePanelSections() {
  const sidePanel = useSidePanel();

  return (
    <Show when={!sidePanel?.isNarrow()}>
      <CalendarMiniCalendarSidePanelSection />
      <CalendarSourcesSidePanelSection />
      <CalendarTeamOooSidePanelSection />
    </Show>
  );
}
