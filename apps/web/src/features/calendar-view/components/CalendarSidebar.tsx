import {
  CollapsibleSection,
  useViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import {
  TEAM_OOO_SOURCE_ID,
  type TeamOooWindow,
  useHasTeammates,
  useUpcomingTeamOoo,
} from '@app/features/calendar/hooks/use-team-ooo';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCalendarTeamOoo } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
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
import { CalendarCallSidebar } from '../calendar-call-sidebar';

function CalendarMiniCalendar() {
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const shell = useViewShell();
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

  const navigateToDate = (date: Date) => {
    setFocusedDay(date);
    calendarPager.gotoDate(date);
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };
  const navigateMonth = (month: Date) => {
    const focused = focusedDay();
    navigateToDate(
      focused.getFullYear() === month.getFullYear() &&
        focused.getMonth() === month.getMonth()
        ? focused
        : month
    );
  };

  createEffect(on(currentDate, setFocusedDay));

  return (
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
      onValueChange={(date) => date && navigateToDate(date)}
    />
  );
}

function UpcomingEventsSection() {
  const [open, setOpen] = createSignal(true);
  const shell = useViewShell();

  return (
    <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
      <CollapsibleSection.Trigger>
        <span class="min-w-0 truncate">Upcoming events</span>
        <CollapsibleSection.Indicator />
      </CollapsibleSection.Trigger>
      <CollapsibleSection.Content>
        <CalendarCallSidebar
          onSelectEvent={() => {
            // Desktop details anchor to the row; only the mobile drawer can
            // close its navigation overlay without losing the event anchor.
            if (isMobile() && shell.aside.isOverlay()) shell.aside.collapse();
          }}
        />
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function CalendarSourcesSection() {
  const calendarView = useCalendarView();
  const [open, setOpen] = createSignal(true);

  return (
    <Show when={calendarView.sources().length > 1}>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Trigger>
          <span class="min-w-0 truncate">Calendars</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <SourceControls
            sources={calendarView.sources()}
            isVisible={calendarView.isSourceVisible}
            onVisibilityChange={calendarView.setSourceVisibility}
          />
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

const UPCOMING_SHOWN_MAX = 10;

function windowDateLabel(window: TeamOooWindow): string {
  const lastDay = new Date(window.end.getTime() - 1);
  return window.start.toDateString() === lastDay.toDateString()
    ? format(window.start, 'EEE, MMM d')
    : `${format(window.start, 'MMM d')} – ${format(lastDay, 'MMM d')}`;
}

function TeamOooSkeleton() {
  return (
    <div aria-hidden="true" class="flex flex-col gap-0.5">
      <For each={[0, 1, 2]}>
        {() => <div class="skeleton-shimmer h-8 w-full rounded-lg bg-skeleton" />}
      </For>
    </div>
  );
}

function TeamOooUpcomingList() {
  const calendarPager = useCalendarPager();
  const shell = useViewShell();
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
                onClick={() => {
                  calendarPager.gotoDate(window.start);
                  if (shell.aside.isOverlay()) shell.aside.collapse();
                }}
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

function CalendarTeamOooSection() {
  const calendarView = useCalendarView();
  const hasTeammates = useHasTeammates();
  const [open, setOpen] = createSignal(true);
  const isOverlayVisible = () =>
    calendarView.isSourceVisible(TEAM_OOO_SOURCE_ID);
  const setOverlayVisible = (visible: boolean) =>
    calendarView.setSourceVisibility(TEAM_OOO_SOURCE_ID, visible);

  return (
    <Show when={hasTeammates()}>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="min-w-0 flex-1">
            <span class="min-w-0 truncate">Team out of office</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <span title="Show on calendar">
            <ToggleSwitch
              checked={isOverlayVisible()}
              onChange={setOverlayVisible}
              aria-label="Show team out of office on the calendar"
            />
          </span>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content>
          <TeamOooUpcomingList />
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

export function CalendarSidebar() {
  return (
    <ViewSidebar.Root aria-label="Calendar navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>Calendar</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Content>
        <CalendarMiniCalendar />
        <UpcomingEventsSection />
        <CalendarSourcesSection />
        <ShowFeatureFlag flag={enableCalendarTeamOoo}>
          <CalendarTeamOooSection />
        </ShowFeatureFlag>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
