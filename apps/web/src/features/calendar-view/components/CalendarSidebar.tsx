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
import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import {
  type TeamOooWindow,
  useHasTeammates,
  useUpcomingTeamOoo,
} from '@app/features/calendar/hooks/use-team-ooo';
import { TEAM_OOO_SOURCE_ID } from '@app/features/calendar/types';
import { CalendarSchedulingActions } from '@app/features/scheduling/calendar-actions';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { UserIcon } from '@core/component/UserIcon';
import { enableCalendarTeamOoo } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, Checkbox, cn, Calendar as MiniCalendar } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { format, getDaysInMonth } from 'date-fns';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { CalendarCallSidebar } from '../calendar-call-sidebar';
import { useCalendarFocus } from '../calendar-focus-target';
import { CALENDAR_TOUR } from '../tour';
import {
  CalendarCreateBookingLinkItem,
  CalendarCreateCallItem,
  CalendarCreateEventItem,
} from './CalendarCreateItems';
import { CalendarCreateMenu } from './CalendarCreateMenu';
import { CalendarSearch } from './CalendarSearch';
import { ConnectCalendarsPromotion } from './ConnectCalendarsPromotion';

export function CalendarMiniCalendar() {
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const initialDate = new Date();

  const currentDate = createMemo(
    () => calendarPager.activeDateInfo()?.view.calendar.getDate() ?? initialDate
  );
  const [focusedDay, setFocusedDay] = createSignal(currentDate());
  const highlightedRange = createMemo(() => {
    const dateInfo = calendarPager.activeDateInfo();
    if (dateInfo?.view.type !== 'timeGridWeek') return undefined;
    return { end: dateInfo.end, start: dateInfo.start };
  });

  // Keep focus local and clamp month-end dates so shorter months stay tabbable.
  return (
    <MiniCalendar
      required
      fixedWeeks
      startOfWeek={calendarView.displaySettings.weekStartsOn}
      value={currentDate()}
      focusedDay={focusedDay()}
      highlightedRange={highlightedRange()}
      onMonthChange={(month) =>
        setFocusedDay(
          new Date(
            month.getFullYear(),
            month.getMonth(),
            Math.min(focusedDay().getDate(), getDaysInMonth(month))
          )
        )
      }
      onFocusedDayChange={setFocusedDay}
      onValueChange={(date) => date && calendarPager.gotoDate(date)}
    />
  );
}

function UpcomingEventsSection() {
  const [open, setOpen] = createSignal(true);

  return (
    <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
      <CollapsibleSection.Header ref={tourTarget(CALENDAR_TOUR.upcoming)}>
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
            ref={tourTarget(CALENDAR_TOUR.sources)}
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

export function TeamOooUpcomingList() {
  const calendarPager = useCalendarPager();
  const shell = useViewShell();
  const upcoming = useUpcomingTeamOoo();
  const windows = upcoming.windows;
  const calendarView = useCalendarView();
  const calendarFocus = useCalendarFocus();
  const isActive = (window: TeamOooWindow) =>
    calendarView.selectedEvent()?.id === window.event.id;
  const openWindow = (window: TeamOooWindow, row: HTMLElement) => {
    const openOnRow = () =>
      calendarView.selectEvent(window.event, row, 'agenda');
    calendarPager.gotoDate(window.start);
    // With the overlay on, the absence also renders on the grid: open it on
    // its chip once the page shows it, as a navigation request does, so the
    // card never opens on the row and then jumps to the chip.
    if (calendarView.isSourceVisible(TEAM_OOO_SOURCE_ID)) {
      calendarFocus.focusOccurrence(
        {
          eventId: window.eventId,
          occurrenceKey: window.occurrenceKey,
          date: window.start,
        },
        openOnRow
      );
    } else {
      openOnRow();
    }
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };
  // The choice outlives count changes: a list that shrinks to the cap and grows
  // again comes back the way the person left it.
  const [expanded, setExpanded] = createSignal(false);
  const hiddenCount = () => windows().length - UPCOMING_SHOWN_MAX;
  const shownWindows = () =>
    expanded() ? windows() : windows().slice(0, UPCOMING_SHOWN_MAX);
  let rowList: HTMLDivElement | undefined;
  const toggleExpanded = (toggle: HTMLElement) => {
    const anchor = calendarView.selectedEventAnchor();
    const anchoredToRow = anchor !== undefined && rowList?.contains(anchor);
    setExpanded((value) => !value);
    // Show less can remove the row an open card is anchored to; a pointer
    // press closes the card as an outside interaction, Enter does not.
    if (anchoredToRow && !anchor.isConnected) calendarView.closeEventDetails();
    // The section is last in the sidebar, so the longer list pushes this
    // focused control below the fold. Its margin keeps the sidebar's bottom
    // inset below it.
    toggle.scrollIntoView({ block: 'nearest' });
  };

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
            No shared time off in the next 90 days
          </span>
        </Match>
        <Match when={windows().length > 0}>
          <div
            ref={rowList}
            class={cn(
              'flex flex-col gap-0.5',
              expanded() && hiddenCount() > 0 && 'max-h-120 overflow-y-auto'
            )}
          >
            <Key each={shownWindows()} by={(window) => window.event.id}>
              {(window) => (
                <button
                  type="button"
                  class={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs',
                    isActive(window()) ? 'bg-active' : 'hover:bg-hover'
                  )}
                  aria-current={isActive(window()) ? 'true' : undefined}
                  onClick={(event) => openWindow(window(), event.currentTarget)}
                >
                  <UserIcon
                    id={window().ownerId}
                    size="md"
                    suppressClick
                    showTooltip={false}
                  />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="flex w-full items-baseline gap-2">
                      <span class="min-w-0 flex-1 truncate text-ink">
                        {window().name}
                      </span>
                      <span class="shrink-0 text-ink-muted">
                        {windowDateLabel(window())}
                      </span>
                    </span>
                    <Show when={window().title}>
                      <span class="w-full truncate text-ink-muted">
                        {window().title}
                      </span>
                    </Show>
                  </span>
                </button>
              )}
            </Key>
          </div>
          <Show when={hiddenCount() > 0}>
            <Button
              variant="ghost"
              size="xs"
              class="self-start scroll-mb-(--sidebar-content-inset)"
              aria-expanded={expanded()}
              onClick={(event) => toggleExpanded(event.currentTarget)}
            >
              {expanded() ? 'Show less' : `+${hiddenCount()} more`}
            </Button>
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

  return (
    <Show when={hasTeammates()}>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Header>
          <Checkbox
            size="sm"
            checked={calendarView.isSourceVisible(TEAM_OOO_SOURCE_ID)}
            onChange={(visible) =>
              calendarView.setSourceVisibility(TEAM_OOO_SOURCE_ID, visible)
            }
            title="Show on calendar"
            class="h-full shrink-0 pr-1 pl-(--sidebar-item-inset)"
          >
            <Checkbox.Control />
            <Checkbox.Label class="absolute inset-0">
              <span class="sr-only">
                Show team out of office on the calendar
              </span>
            </Checkbox.Label>
          </Checkbox>
          <CollapsibleSection.Trigger class="min-w-0 flex-1 pl-1">
            <span class="min-w-0 truncate">Team out of office</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
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
        aria-label="Close calendar navigation"
        onClick={shell.aside.collapse}
      >
        <CloseIcon class="size-4" />
      </ViewSidebar.Control>
    </Show>
  );
}

export function CalendarSidebar() {
  const shell = useViewShell();
  const searchEnabled = useCalendarSearchUiFlag();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const closeOverlay = () => {
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };

  return (
    <ViewSidebar.Root aria-label="Calendar navigation">
      <ViewSidebar.Header
        searchLabel="Search events"
        searchOpen={searchOpen()}
        onSearchOpenChange={setSearchOpen}
        search={
          searchEnabled()
            ? () => (
                <CalendarSearch
                  inline
                  expanded
                  popupReady
                  onDismiss={() => setSearchOpen(false)}
                />
              )
            : undefined
        }
      >
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>Calendar</ViewSidebar.Title>
        </div>
        <CalendarSidebarOverlayClose />
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <CalendarCreateMenu
          presentation={isTouchDevice() ? undefined : 'sidebar'}
          size="md"
          class="h-(--sidebar-row-height) w-full min-w-0 justify-start gap-(--sidebar-label-gap) px-(--sidebar-item-inset) text-left touch:h-11"
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
          <CalendarCreateBookingLinkItem onSelect={closeOverlay} />
        </CalendarCreateMenu>
      </ViewSidebar.Primary>
      <ViewSidebar.Content class="pt-2">
        <CalendarMiniCalendar />
        <Show when={shell.breakpoints.narrow?.()}>
          <CalendarSchedulingActions sidebar />
        </Show>
        <UpcomingEventsSection />
        <CalendarSourcesSection />
        <ShowFeatureFlag flag={enableCalendarTeamOoo}>
          <CalendarTeamOooSection />
        </ShowFeatureFlag>
      </ViewSidebar.Content>
      {/* Outside the scrolling list, so a long list never slides it under Settings. */}
      <ConnectCalendarsPromotion class="px-(--sidebar-gutter) pt-2" />
      <ViewSidebar.Footer class="border-0">
        <ViewSidebar.Nav aria-label="Calendar tools">
          <CalendarSettingsDropdown sidebar />
        </ViewSidebar.Nav>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}
