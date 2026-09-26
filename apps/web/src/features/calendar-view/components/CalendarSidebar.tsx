import {
  CollapsibleSection,
  useViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { CopyAvailabilityButton } from '@app/features/calendar/availability/CopyAvailabilityButton';
import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { CalendarSettingsDropdown } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import {
  TEAM_OOO_SOURCE_ID,
  type TeamOooWindow,
  useHasTeammates,
  useUpcomingTeamOoo,
} from '@app/features/calendar/hooks/use-team-ooo';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { UserIcon } from '@core/component/UserIcon';
import { enableCalendarTeamOoo } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import CloseIcon from '@phosphor/x.svg';
import { Calendar as MiniCalendar, cn, ToggleSwitch } from '@ui';
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
import {
  CalendarCreateCallItem,
  CalendarCreateEventItem,
  CalendarCreateReminderItem,
} from './CalendarCreateItems';
import { CalendarCreateMenu } from './CalendarCreateMenu';

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
    if (dateInfo?.view.type !== 'timeGridWeek') return undefined;
    return { end: dateInfo.end, start: dateInfo.start };
  });

  const navigateToDate = (date: Date) => {
    setFocusedDay(date);
    calendarPager.gotoDate(date);
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };
  const navigateMonth = (month: Date) => {
    const sameMonth =
      focused.getFullYear() === month.getFullYear() &&
      focused.getMonth() === month.getMonth();
    navigateToDate(sameMonth ? focused : month);
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

  return (
    <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger class="min-w-0 flex-1">
          <span class="min-w-0 truncate">Upcoming events</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CopyAvailabilityButton class="size-(--sidebar-control-size) rounded-lg" />
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <CalendarCallSidebar />
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
            onGroupVisibilityChange={calendarView.setSourcesVisibility}
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
        {() => (
          <div class="skeleton-shimmer h-8 w-full rounded-lg bg-skeleton" />
        )}
      </For>
    </div>
  );
}

function TeamOooUpcomingList() {
  const calendarPager = useCalendarPager();
  const shell = useViewShell();
  const upcoming = useUpcomingTeamOoo();
  const windows = upcoming.windows;
  const calendarView = useCalendarView();
  const isActive = (window: TeamOooWindow) =>
    calendarView.selectedEvent()?.id === window.event.id;

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
                class={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs',
                  isActive(window) ? 'bg-active' : 'hover:bg-hover'
                )}
                aria-current={isActive(window) ? 'true' : undefined}
                onClick={(event) => {
                  calendarPager.gotoDate(window.start);
                  calendarView.selectEvent(
                    window.event,
                    event.currentTarget,
                    'agenda'
                  );
                  if (shell.aside.isOverlay()) shell.aside.collapse();
                }}
              >
                <UserIcon
                  id={window.ownerId}
                  size="md"
                  suppressClick
                  showTooltip={false}
                />
                <span class="flex min-w-0 flex-1 flex-col">
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
                </span>
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

function CalendarSidebarOverlayClose() {
  const shell = useViewShell();
  return (
    <Show when={shell.aside.isOverlay() && isTouchDevice()}>
      <ViewSidebar.Control
        label="Close calendar navigation"
        onClick={shell.aside.collapse}
      >
        <CloseIcon class="size-4" />
      </ViewSidebar.Control>
    </Show>
  );
}

export function CalendarSidebar() {
  const shell = useViewShell();
  const closeOverlay = () => {
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };

  return (
    <ViewSidebar.Root aria-label="Calendar navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>Calendar</ViewSidebar.Title>
        </div>
        <CalendarSidebarOverlayClose />
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <CalendarCreateMenu
          size="md"
          class="h-(--sidebar-row-height) w-full min-w-0 justify-start gap-(--sidebar-label-gap) px-(--sidebar-item-inset) text-left touch:h-11"
          contentClass="w-[var(--kb-popper-anchor-width)] min-w-40"
          trigger={
            <>
              <ViewSidebar.Icon>
                <PlusIcon class="size-4" />
              </ViewSidebar.Icon>
              <span class="min-w-0 flex-1 truncate">New</span>
              <CaretDownIcon class="size-3.5 shrink-0" />
            </>
          }
        >
          <CalendarCreateEventItem onSelect={closeOverlay} />
          <CalendarCreateCallItem onSelect={closeOverlay} />
          <CalendarCreateReminderItem onSelect={closeOverlay} />
        </CalendarCreateMenu>
      </ViewSidebar.Primary>
      <ViewSidebar.Content class="pt-2">
        <CalendarMiniCalendar />
        <UpcomingEventsSection />
        <CalendarSourcesSection />
        <ShowFeatureFlag flag={enableCalendarTeamOoo}>
          <CalendarTeamOooSection />
        </ShowFeatureFlag>
      </ViewSidebar.Content>
      <ViewSidebar.Footer class="border-0">
        <ViewSidebar.Nav aria-label="Calendar tools">
          <CalendarSettingsDropdown sidebar />
        </ViewSidebar.Nav>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}
