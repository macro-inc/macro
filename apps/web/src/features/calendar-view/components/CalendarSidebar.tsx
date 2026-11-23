import {
  CollapsibleSection,
  useViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { CopyAvailabilityButton } from '@app/features/calendar/availability/CopyAvailabilityButton';
import { CalendarSettingsDropdown } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { MonthYearPickerPopover } from '@app/features/calendar/components/month-picker/MonthPickerPopover';
import { SourceControls } from '@app/features/calendar/components/SourceControls';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import {
  type TeamOooWindow,
  useHasTeammates,
  useUpcomingTeamOoo,
} from '@app/features/calendar/hooks/use-team-ooo';
import { miniMonthMarkers } from '@app/features/calendar/primitives/mini-month-markers';
import {
  DEFAULT_CALENDAR_SOURCE,
  TEAM_OOO_SOURCE_ID,
} from '@app/features/calendar/types';
import { SidebarRoutineSuggestions } from '@app/features/routine-suggestions/routine-suggestions';
import { CalendarSchedulingActions } from '@app/features/scheduling/calendar-actions';
import { TutorialSidebarItem } from '@app/features/video-tutorials';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { formatLocale, t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { enableCalendarTeamOoo } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Key } from '@solid-primitives/keyed';
import {
  Button,
  type CalendarMonthSelectorProps,
  Checkbox,
  cn,
  Calendar as MiniCalendar,
} from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { addDays, format, getDaysInMonth, startOfWeek } from 'date-fns';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { useCalendarFocus } from '../calendar-focus-target';
import { CALENDAR_TOUR } from '../tour';
import { MobileCalendarSidebar } from '../views/mobile/calendar-sidebar';
import { NeedsReplyList } from '../views/needs-reply/NeedsReplyList';
import {
  CalendarCreateBookingLinkItem,
  CalendarCreateCallItem,
  CalendarCreateEventItem,
} from './CalendarCreateItems';
import { CalendarCreateMenu } from './CalendarCreateMenu';
import { ConnectCalendarsPromotion } from './ConnectCalendarsPromotion';

function MiniMonthControl(props: CalendarMonthSelectorProps) {
  const [open, setOpen] = createSignal(false);
  return (
    <MonthYearPickerPopover
      value={props.month}
      open={open()}
      onOpenChange={setOpen}
      triggerSize="sm"
      onChange={props.onChange}
      onGoToDate={(date) =>
        props.onChange(new Date(date.getFullYear(), date.getMonth(), 1))
      }
    >
      <span class="min-w-0 truncate">
        {new Intl.DateTimeFormat(formatLocale(), {
          month: 'long',
          year: 'numeric',
        }).format(props.month)}
      </span>
      <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
    </MonthYearPickerPopover>
  );
}
export function CalendarMiniCalendar() {
  const calendarView = useCalendarView();
  const navigation = useCalendarNavigation();
  const initialDate = new Date();

  const currentDate = createMemo(() => navigation.activeDate() ?? initialDate);
  const [focusedDay, setFocusedDay] = createSignal(currentDate());
  const [month, setMonth] = createSignal(currentDate());
  const gridStart = createMemo(() =>
    startOfWeek(new Date(month().getFullYear(), month().getMonth(), 1), {
      weekStartsOn: calendarView.displaySettings.weekStartsOn,
    })
  );
  const gridEnd = createMemo(() => addDays(gridStart(), 42));
  const data = useCalendarOccurrenceData({
    range: () => createCalendarOccurrenceQueryRange(gridStart(), gridEnd()),
    sourceById: calendarView.sourceById,
    sourcesReady: calendarView.sourcesReady,
    isSourceVisible: calendarView.isSourceVisible,
  });
  const markersByDay = createMemo(() =>
    miniMonthMarkers(data.visibleEvents(), gridStart(), gridEnd())
  );
  const highlightedRange = createMemo(navigation.weekRange);

  // Keep focus local and clamp month-end dates so shorter months stay tabbable.
  return (
    <MiniCalendar
      monthControl={MiniMonthControl}
      required
      fixedWeeks
      startOfWeek={calendarView.displaySettings.weekStartsOn}
      value={currentDate()}
      focusedDay={focusedDay()}
      highlightedRange={highlightedRange()}
      month={month()}
      markersByDay={markersByDay()}
      onMonthChange={(nextMonth) => {
        setMonth(nextMonth);
        setFocusedDay(
          new Date(
            nextMonth.getFullYear(),
            nextMonth.getMonth(),
            Math.min(focusedDay().getDate(), getDaysInMonth(nextMonth))
          )
        );
      }}
      onFocusedDayChange={setFocusedDay}
      onValueChange={(date) => {
        if (!date) return;
        setMonth(date);
        navigation.gotoDate(date);
      }}
    />
  );
}

function NeedsReplySection() {
  const [open, setOpen] = createSignal(true);

  return (
    <CollapsibleSection.Root
      sectionId="upcoming"
      sectionLabel="Upcoming events"
      open={open()}
      onOpenChange={setOpen}
    >
      <CollapsibleSection.Header ref={tourTarget(CALENDAR_TOUR.upcoming)}>
        <CollapsibleSection.Trigger class="min-w-0 flex-1">
          <span class="min-w-0 truncate">{t('calendar.needsReply')}</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CopyAvailabilityButton class="size-(--sidebar-control-size) rounded-lg" />
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <NeedsReplyList />
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function CalendarSourcesSection() {
  const calendarView = useCalendarView();
  const [open, setOpen] = createSignal(true);

  return (
    <Show
      when={calendarView
        .sources()
        .some((source) => source.id !== DEFAULT_CALENDAR_SOURCE.id)}
    >
      <CollapsibleSection.Root
        sectionId="calendars"
        sectionLabel="Calendars"
        open={open()}
        onOpenChange={setOpen}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger>
            <span class="min-w-0 truncate">Calendars</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
        </CollapsibleSection.Header>
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
  const navigation = useCalendarNavigation();
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
    navigation.gotoDate(window.start);
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
        <Match when={windows().length === 0 && !upcoming.isError()}>
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
      <Show when={upcoming.isError()}>
        <span role="alert" class="px-2 py-1 text-xs text-ink-muted">
          Couldn't load time off
        </span>
      </Show>
    </div>
  );
}

function CalendarTeamOooSection() {
  const calendarView = useCalendarView();
  const hasTeammates = useHasTeammates();
  const [open, setOpen] = createSignal(true);

  return (
    <Show when={hasTeammates()}>
      <CollapsibleSection.Root
        sectionId="team-ooo"
        sectionLabel="Team out of office"
        open={open()}
        onOpenChange={setOpen}
      >
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

function DesktopCalendarSidebar() {
  const shell = useViewShell();
  const composerHost = useCalendarComposerHost();
  const closeOverlay = () => {
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };

  return (
    <ViewSidebar.Root
      aria-label="Calendar navigation"
      reorderId="calendar"
      data-calendar-sidebar=""
      class={composerHost?.drag()?.state.active ? 'invisible' : undefined}
    >
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton />
          <ViewSidebar.Title>Calendar</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <CalendarCreateMenu
          restoreFocus={!composerHost?.sessions.state.session}
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
        <SidebarRoutineSuggestions surface="calendar" />
        <ViewSidebar.Nav
          aria-label={t('tutorials.watchTutorial')}
          class="empty:hidden"
        >
          <TutorialSidebarItem tutorial="calendar" />
        </ViewSidebar.Nav>
        <ViewSidebar.Section
          id="month"
          label={t('viewMenus.monthCalendar')}
          headerless
        >
          <CalendarMiniCalendar />
        </ViewSidebar.Section>
        <Show when={shell.breakpoints.narrow?.()}>
          <CalendarSchedulingActions sidebar />
        </Show>
        <NeedsReplySection />
        <CalendarSourcesSection />
        <ShowFeatureFlag flag={enableCalendarTeamOoo}>
          <CalendarTeamOooSection />
        </ShowFeatureFlag>
      </ViewSidebar.Content>
      {/* Outside the scrolling list, so a long list never slides it under Settings. */}
      <ConnectCalendarsPromotion class="px-(--sidebar-gutter) pt-2" />
      <ViewSidebar.Footer class="border-0 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+0.75rem)]">
        <ViewSidebar.Nav aria-label="Calendar tools">
          <CalendarSettingsDropdown sidebar />
        </ViewSidebar.Nav>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}

export function CalendarSidebar() {
  return (
    <Show when={isTouchDevice()} fallback={<DesktopCalendarSidebar />}>
      <MobileCalendarSidebar />
    </Show>
  );
}
