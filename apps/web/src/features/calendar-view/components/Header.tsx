import { useViewShell, ViewShell } from '@app/components/view-shell';
import { CopyAvailabilityButton } from '@app/features/calendar/availability/CopyAvailabilityButton';
import { useCalendarPager } from '@app/features/calendar/components/CalendarPagerContext';
import { CalendarSettingsDropdown } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { MonthDrawer } from '@app/features/calendar/components/MonthDrawer';
import { PeriodSelector } from '@app/features/calendar/components/PeriodSelector';
import { useCalendarHotkeys } from '@app/features/calendar/hooks/use-calendar-hotkeys';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
import { CalendarSchedulingActions } from '@app/features/scheduling/calendar-actions';
import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ListIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, ButtonGroup, cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { CALENDAR_TOUR } from '../tour';
import {
  CalendarCreateCallItem,
  CalendarCreateEventItem,
} from './CalendarCreateItems';
import { CalendarCreateMenu } from './CalendarCreateMenu';
import { CalendarSearch } from './CalendarSearch';

const formatMonthTitle = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
}).format;

function createLocalToday() {
  const [today, setToday] = createSignal(new Date());
  let refreshTimer: number | undefined;

  const scheduleRefresh = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);

    refreshTimer = window.setTimeout(
      () => {
        setToday(new Date());
        scheduleRefresh();
      },
      nextMidnight.getTime() - now.getTime() + 100
    );
  };

  scheduleRefresh();

  onCleanup(() => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
  });

  return today;
}

export function Header(props: {
  presentation: 'workspace' | 'preview';
  leading?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  // Inline previews use the host's shell, not Calendar's sidebar state.
  const shell = props.presentation === 'workspace' ? useViewShell() : undefined;
  const calendarPager = useCalendarPager();
  const calendarView = useCalendarView();
  const initialDate = new Date();
  const [headerElement, setHeaderElement] = createSignal<HTMLElement>();
  const paneSize = createElementSize(() =>
    headerElement()?.closest<HTMLElement>('[data-view-shell-main]')
  );
  // Measure the parent pane so toolbar content cannot affect its own breakpoint.
  // A docked sidebar hides the navigation toggle, so its toolbar fits sooner.
  const hasDockedSidebar = () =>
    !!shell && !shell.aside.isCollapsed() && !shell.aside.isOverlay();
  const breakpoints = createSizeBreakpoints(
    () => paneSize.width ?? 0,
    () => ({
      fullHeader: { min: hasDockedSidebar() ? 580 : 600 },
      inlineSearch: { min: 1040 },
      labeledNew: { min: 360 },
      labeledToday: { min: 304 },
    })
  );
  const isCompactHeader = () => !breakpoints.fullHeader();
  const searchOverlaysControls = () => !breakpoints.inlineSearch();
  const today = createLocalToday();
  const [searchExpanded, setSearchExpandedInternal] = createSignal(false);
  const [searchPopupReady, setSearchPopupReady] = createSignal(false);
  let searchExpansionTimer: number | undefined;
  const clearSearchExpansionTimer = () => {
    if (searchExpansionTimer !== undefined) {
      clearTimeout(searchExpansionTimer);
      searchExpansionTimer = undefined;
    }
  };
  const finishSearchExpansion = () => {
    clearSearchExpansionTimer();
    setSearchPopupReady(searchExpanded());
  };
  const setSearchExpanded = (expanded: boolean) => {
    clearSearchExpansionTimer();
    setSearchPopupReady(false);
    setSearchExpandedInternal(expanded);
    if (!expanded) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishSearchExpansion();
      return;
    }
    // Let the popup fade in as the 200ms width transition settles.
    searchExpansionTimer = window.setTimeout(finishSearchExpansion, 140);
  };
  const handleSearchTransitionEnd = (event: TransitionEvent) => {
    if (
      event.target === event.currentTarget &&
      event.propertyName === 'width'
    ) {
      finishSearchExpansion();
    }
  };
  onCleanup(clearSearchExpansionTimer);
  useCalendarHotkeys({
    scopeId: panel.splitHotkeyScope,
    changeView: calendarPager.changeView,
    previousPeriod: calendarPager.previousPeriod,
    nextPeriod: calendarPager.nextPeriod,
    navigateToToday: calendarPager.navigateToToday,
  });

  const currentDate = createMemo(
    () => calendarPager.navigationDate() ?? initialDate
  );
  const dateTitle = createMemo(() => formatMonthTitle(currentDate()));
  const periodLabel = createMemo(() =>
    calendarPeriodLabel(calendarView.displaySettings.periodView).toLowerCase()
  );
  const isNarrow = () => shell?.aside.isCollapsed() ?? true;
  const showBookingLinks = () => isMobile() || !shell?.breakpoints.narrow?.();
  const usesSplitHeader = () => isTouchDevice();
  const createItems = () => (
    <>
      <CalendarCreateEventItem />
      <CalendarCreateCallItem />
    </>
  );
  const headerCreateMenu = () => (
    <CalendarCreateMenu
      presentation={!isTouchDevice() ? 'toolbar' : undefined}
      size={breakpoints.labeledNew() ? 'md' : 'icon-md'}
      label="New"
      class={cn(
        'shrink-0 rounded-full touch:h-11',
        breakpoints.labeledNew() &&
          'h-(--sidebar-row-height) gap-(--sidebar-label-gap) px-(--sidebar-item-inset)'
      )}
      trigger={
        <>
          <PlusIcon class="size-3.5" />
          <Show when={breakpoints.labeledNew()}>
            <span>New</span>
            <CaretDownIcon class="size-3.5 shrink-0" />
          </Show>
        </>
      }
    >
      {createItems()}
    </CalendarCreateMenu>
  );

  const previous = (compact = false) => (
    <Button
      variant="ghost"
      size={compact ? 'icon-md' : 'icon-lg'}
      class="border-transparent bg-transparent"
      label={`Previous ${periodLabel()}`}
      hotkey={TOKENS.calendar.period.previous}
      onClick={calendarPager.previousPeriod}
    >
      <CaretLeftIcon class={compact ? 'size-4' : 'size-5'} />
    </Button>
  );
  const next = (compact = false) => (
    <Button
      variant="ghost"
      size={compact ? 'icon-md' : 'icon-lg'}
      class="border-transparent bg-transparent"
      label={`Next ${periodLabel()}`}
      hotkey={TOKENS.calendar.period.next}
      onClick={calendarPager.nextPeriod}
    >
      <CaretRightIcon class={compact ? 'size-4' : 'size-5'} />
    </Button>
  );
  const todayButton = (mobile: boolean, compact = false) => (
    <Button
      variant={mobile || compact ? 'ghost' : 'outline'}
      size={compact ? (mobile ? 'icon-md' : 'md') : mobile ? 'icon-lg' : 'lg'}
      class={cn(
        mobile && 'relative',
        !mobile && 'bg-transparent text-sm',
        !mobile && (compact ? 'px-2' : 'px-3'),
        !mobile && !compact && 'border-edge-button'
      )}
      label="Go to today"
      hotkey={TOKENS.calendar.period.today}
      onClick={calendarPager.navigateToToday}
    >
      <Show when={mobile} fallback="Today">
        <CalendarBlankIcon aria-hidden="true" />
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 flex items-center justify-center pt-1 text-[10px] font-bold leading-none"
        >
          {today().getDate()}
        </span>
      </Show>
    </Button>
  );

  return (
    <Switch>
      <Match when={usesSplitHeader()}>
        <SplitHeaderLeft>
          <HeaderIsland class="min-w-0 shrink px-1">
            <Show when={!isMobile() && shell?.aside.isCollapsed()}>
              <Button
                variant="ghost"
                size="icon-sm"
                class="shrink-0"
                label="Show calendar navigation"
                ref={tourTarget(CALENDAR_TOUR.sidebarToggle)}
                aria-expanded={shell?.aside.isOverlay() ?? false}
                onClick={() => shell?.aside.expand()}
              >
                <ListIcon class="size-5" />
              </Button>
            </Show>
            <MonthDrawer month={currentDate()} />
            {todayButton(isTouchDevice())}
            <Show when={props.presentation === 'preview'}>
              <CalendarCreateMenu
                size="icon-lg"
                class="shrink-0 rounded-full border-transparent bg-transparent"
                label="New"
                trigger={<PlusIcon class="size-5" />}
              >
                {createItems()}
              </CalendarCreateMenu>
            </Show>
          </HeaderIsland>
        </SplitHeaderLeft>

        <SplitHeaderRight>
          <HeaderIsland class="px-1">
            <div
              ref={tourTarget(CALENDAR_TOUR.period)}
              class="flex items-center gap-1"
            >
              <Show when={!isMobile()}>
                <PeriodSelector isNarrow={isNarrow()} />
                <div class="flex shrink-0 items-center gap-1">
                  {previous()}
                  {next()}
                </div>
              </Show>
              <Show when={isMobile() && props.presentation === 'workspace'}>
                <CopyAvailabilityButton size="icon-lg" />
              </Show>
              <Show when={!isMobile()}>
                <CalendarSearch />
              </Show>
              <Show when={showBookingLinks()}>
                <CalendarSchedulingActions />
              </Show>
              <Show when={props.presentation === 'preview' || isMobile()}>
                <CalendarSettingsDropdown isNarrow={isNarrow()} />
              </Show>
            </div>
          </HeaderIsland>
        </SplitHeaderRight>
      </Match>
      <Match when={!usesSplitHeader()}>
        <ViewShell.TopBar
          ref={setHeaderElement}
          class="@container/calendar-toolbar h-auto min-h-12 flex-wrap gap-x-2 gap-y-2 py-2 [--view-search-height:2rem]"
        >
          <div class="relative flex min-w-0 flex-1 items-center gap-2">
            {props.leading}
            <h1 class="min-w-0 truncate px-1 text-sm font-semibold text-ink">
              {dateTitle()}
            </h1>
          </div>
          <div
            class={cn(
              'relative flex shrink-0 items-center justify-end gap-2',
              isCompactHeader() && 'basis-full'
            )}
            data-calendar-period-controls=""
            ref={tourTarget(CALENDAR_TOUR.period)}
            onClick={() => setSearchExpanded(false)}
          >
            <div
              class="flex items-center gap-2"
              classList={{
                invisible: searchOverlaysControls() && searchExpanded(),
                'pointer-events-none':
                  searchOverlaysControls() && searchExpanded(),
              }}
            >
              <Show when={showBookingLinks()}>
                <CalendarSchedulingActions compact />
              </Show>
              <div
                role="group"
                aria-label="Calendar navigation"
                class="flex shrink-0"
              >
                <ButtonGroup variant="outline" size="icon-md">
                  {todayButton(!breakpoints.labeledToday(), true)}
                  {previous(true)}
                  {next(true)}
                </ButtonGroup>
              </div>
              <div
                role="group"
                aria-label="Calendar view"
                class="flex shrink-0"
              >
                <ButtonGroup variant="outline" size="icon-md">
                  <PeriodSelector isNarrow={isNarrow()} compact />
                </ButtonGroup>
              </div>
              {headerCreateMenu()}
            </div>
            <div
              onTransitionEnd={handleSearchTransitionEnd}
              onClick={(event) => event.stopPropagation()}
              class={cn(
                'h-8 shrink-0',
                searchOverlaysControls()
                  ? 'w-8'
                  : 'transition-[width] duration-200 ease-out motion-reduce:transition-none'
              )}
              style={
                searchOverlaysControls()
                  ? undefined
                  : {
                      width: searchExpanded()
                        ? 'clamp(22rem, 40cqw, 28rem)'
                        : '2rem',
                    }
              }
            >
              <div
                onTransitionEnd={handleSearchTransitionEnd}
                class={cn(
                  'h-8',
                  searchOverlaysControls() &&
                    'absolute right-0 top-0 transition-[width] duration-200 ease-out motion-reduce:transition-none'
                )}
                style={
                  searchOverlaysControls()
                    ? {
                        width: searchExpanded() ? 'min(100%, 28rem)' : '2rem',
                      }
                    : undefined
                }
              >
                <CalendarSearch
                  inline
                  compact={searchOverlaysControls()}
                  expanded={searchExpanded()}
                  popupReady={searchPopupReady()}
                  onExpand={() => setSearchExpanded(true)}
                  onDismiss={() => setSearchExpanded(false)}
                />
              </div>
            </div>
          </div>
        </ViewShell.TopBar>
      </Match>
    </Switch>
  );
}
