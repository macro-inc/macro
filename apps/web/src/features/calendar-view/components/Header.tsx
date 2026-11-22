import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { MonthDrawer } from '@app/features/calendar/components/MonthDrawer';
import { MonthPickerPopover } from '@app/features/calendar/components/month-picker/MonthPickerPopover';
import { PeriodSelector } from '@app/features/calendar/components/PeriodSelector';
import { CalendarViewTabs } from '@app/features/calendar/components/view-tabs/CalendarViewTabs';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useCalendarHotkeys } from '@app/features/calendar/hooks/use-calendar-hotkeys';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
import { CalendarSchedulingActions } from '@app/features/scheduling/calendar-actions';
import { beginInteraction } from '@app/observability/flow';
import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, ButtonGroup, cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { CALENDAR_TOUR } from '../tour';
import {
  CalendarCreateBookingLinkItem,
  CalendarCreateCallItem,
  CalendarCreateEventItem,
} from './CalendarCreateItems';
import { CalendarCreateMenu } from './CalendarCreateMenu';
import { CalendarSearch } from './CalendarSearch';

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
  const composerHost = useCalendarComposerHost();
  // Inline previews use the host's shell, not Calendar's sidebar state.
  const shell = props.presentation === 'workspace' ? useViewShell() : undefined;
  const navigation = useCalendarNavigation();
  const calendarView = useCalendarView();
  const initialDate = new Date();
  const [headerElement, setHeaderElement] = createSignal<HTMLElement>();
  const paneSize = createElementSize(() =>
    headerElement()?.closest<HTMLElement>('[data-view-shell-main]')
  );
  // Keep the redesigned desktop breakpoint independent of toolbar content.
  const breakpoints = createSizeBreakpoints(
    () => paneSize.width ?? 0,
    () => ({
      fullHeader: { min: 760 },
      inlineSearch: { min: 1040 },
      labeledToday: { min: 304 },
    })
  );
  const isCompactHeader = () => !breakpoints.fullHeader();
  const searchOverlaysControls = isCompactHeader;
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
  const [monthPicker, setMonthPicker] = createStore({
    open: false,
    focusDateEntry: false,
  });
  const goToDate = () => setMonthPicker({ open: true, focusDateEntry: true });
  const selectDate = (date: Date) => {
    const interaction = beginInteraction('calendar.date.jump');
    try {
      setMonthPicker({ open: false, focusDateEntry: false });
      navigation.navigateToDate(date);
    } finally {
      interaction.end();
    }
  };
  useCalendarHotkeys({
    scopeId: panel.splitHotkeyScope,
    changeView: navigation.changeView,
    previousPeriod: navigation.previousPeriod,
    nextPeriod: navigation.nextPeriod,
    navigateToToday: navigation.navigateToToday,
    goToDate: isTouchDevice() ? undefined : goToDate,
  });

  const currentDate = createMemo(
    () => navigation.navigationDate() ?? initialDate
  );
  const periodLabel = createMemo(() => {
    const period = calendarView.displaySettings.periodView;
    return calendarPeriodLabel(
      period === 'agenda' ? 'timeGridWeek' : period
    ).toLowerCase();
  });
  const isNarrow = () => shell?.aside.isCollapsed() ?? true;
  const showBookingLinks = () => isMobile() || !shell?.breakpoints.narrow?.();
  const usesTouchHeader = () => isTouchDevice();
  function TouchHeader(props: ParentProps) {
    return (
      <Show when={shell} fallback={props.children}>
        {/* Floats over the pane, which reserves its measured height. */}
        <ViewShell.TopBar
          class="touch:flex"
          navigation={
            <ViewSidebar.Toggle action="expand" presentation="pill" />
          }
        >
          {props.children}
        </ViewShell.TopBar>
      </Show>
    );
  }
  function TouchHeaderLeft(props: ParentProps) {
    return (
      <Show
        when={shell}
        fallback={<SplitHeaderLeft>{props.children}</SplitHeaderLeft>}
      >
        <div class="flex min-w-0 shrink items-center">{props.children}</div>
      </Show>
    );
  }
  function TouchHeaderRight(props: ParentProps) {
    return (
      <Show
        when={shell}
        fallback={<SplitHeaderRight>{props.children}</SplitHeaderRight>}
      >
        <div class="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          {props.children}
        </div>
      </Show>
    );
  }
  const createItems = () => (
    <>
      <CalendarCreateEventItem />
      <CalendarCreateCallItem />
      <CalendarCreateBookingLinkItem />
    </>
  );
  const headerCreateMenu = () => (
    <CalendarCreateMenu
      presentation="toolbar"
      restoreFocus={!composerHost?.sessions.state.session}
    >
      {createItems()}
    </CalendarCreateMenu>
  );

  const previous = (compact = false) => {
    const Control = compact ? ButtonGroup.Button : Button;
    return (
      <Control
        aria-label={`Previous ${periodLabel()}`}
        tooltip={{
          content: `Previous ${periodLabel()}`,
          hotkey: TOKENS.calendar.period.previous,
        }}
        variant="ghost"
        size={compact ? 'icon-md' : 'icon-lg'}
        class="border-transparent bg-transparent"
        onClick={navigation.previousPeriod}
      >
        <CaretLeftIcon class={compact ? 'size-4' : 'size-5'} />
      </Control>
    );
  };
  const next = (compact = false) => {
    const Control = compact ? ButtonGroup.Button : Button;
    return (
      <Control
        aria-label={`Next ${periodLabel()}`}
        tooltip={{
          content: `Next ${periodLabel()}`,
          hotkey: TOKENS.calendar.period.next,
        }}
        variant="ghost"
        size={compact ? 'icon-md' : 'icon-lg'}
        class="border-transparent bg-transparent"
        onClick={navigation.nextPeriod}
      >
        <CaretRightIcon class={compact ? 'size-4' : 'size-5'} />
      </Control>
    );
  };
  const todayButton = (mobile: boolean, compact = false) => {
    const Control = compact ? ButtonGroup.Button : Button;
    return (
      <Control
        aria-label="Go to today"
        tooltip={{
          content: 'Go to today',
          hotkey: TOKENS.calendar.period.today,
        }}
        variant={mobile || compact ? 'ghost' : 'secondary'}
        size={mobile ? 'icon-md' : 'md'}
        class={cn(
          mobile && 'relative',
          !mobile && 'bg-transparent text-sm',
          !mobile && (compact ? 'px-2' : 'px-3'),
          !mobile && !compact && 'border-edge-button'
        )}
        onClick={navigation.navigateToToday}
      >
        <Show when={mobile} fallback="Today">
          <CalendarBlankIcon
            class="size-4 touch:size-6 shrink-0 pointer-events-none"
            aria-hidden="true"
          />
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 flex items-center justify-center pt-1 text-[10px] font-bold leading-none"
          >
            {today().getDate()}
          </span>
        </Show>
      </Control>
    );
  };
  return (
    <Switch>
      <Match when={usesTouchHeader()}>
        <TouchHeader>
          <TouchHeaderLeft>
            <HeaderIsland class="min-w-0 shrink px-1">
              <MonthDrawer month={currentDate()} />
            </HeaderIsland>
          </TouchHeaderLeft>

          <TouchHeaderRight>
            <ViewShell.TopBarIsland class="size-10 justify-center p-0">
              {todayButton(true)}
            </ViewShell.TopBarIsland>
            <ViewShell.TopBarIsland class="size-10 justify-center p-0">
              <CalendarSearch />
            </ViewShell.TopBarIsland>
          </TouchHeaderRight>
        </TouchHeader>
      </Match>
      <Match when={!usesTouchHeader()}>
        <ViewShell.TopBar
          ref={setHeaderElement}
          class="@container/calendar-toolbar h-auto min-h-12 flex-wrap items-start gap-x-2 not-touch:gap-y-4 py-2 [--view-search-height:2rem]"
        >
          <div
            class="relative flex min-w-0 flex-1 items-center gap-2"
            data-calendar-period-controls=""
            ref={tourTarget(CALENDAR_TOUR.period)}
            onClick={() => setSearchExpanded(false)}
          >
            <div
              class="flex min-w-0 flex-1 items-center gap-2"
              classList={{
                invisible: searchOverlaysControls() && searchExpanded(),
                'pointer-events-none':
                  searchOverlaysControls() && searchExpanded(),
              }}
            >
              {props.leading}
              <HeaderActionGroup label="Calendar navigation" size="md">
                {previous(true)}
                {next(true)}
              </HeaderActionGroup>
              {todayButton(!breakpoints.labeledToday())}
              <div class="flex-1" />
              <Show
                when={!isCompactHeader()}
                fallback={
                  <HeaderActionGroup label="Calendar view" size="md">
                    <PeriodSelector isNarrow={isNarrow()} compact grouped />
                  </HeaderActionGroup>
                }
              >
                <CalendarViewTabs
                  value={navigation.periodView()}
                  onChange={navigation.changeView}
                />
              </Show>
            </div>
            <div
              onTransitionEnd={handleSearchTransitionEnd}
              onClick={(event) => event.stopPropagation()}
              class={cn(
                'h-8 shrink-0',
                searchOverlaysControls() ? 'w-8' : 'w-52'
              )}
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
                  expanded={
                    searchOverlaysControls() ? searchExpanded() : undefined
                  }
                  popupReady={!searchOverlaysControls() || searchPopupReady()}
                  onExpand={() => setSearchExpanded(true)}
                  onOpenChange={setSearchExpanded}
                  onDismiss={
                    searchOverlaysControls()
                      ? () => setSearchExpanded(false)
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
          <div class="flex min-h-9 min-w-0 basis-full items-center gap-2">
            <h1 class="-ml-1 min-w-0 flex-1">
              <MonthPickerPopover
                date={currentDate()}
                open={monthPicker.open}
                focusDateEntry={monthPicker.focusDateEntry}
                onOpenChange={(open) =>
                  setMonthPicker({ open, focusDateEntry: false })
                }
                onSelect={selectDate}
              />
            </h1>
            <div
              class="flex shrink-0 items-center gap-2"
              onClick={() => setSearchExpanded(false)}
            >
              <Show when={showBookingLinks()}>
                <CalendarSchedulingActions compact />
              </Show>
              {headerCreateMenu()}
            </div>
          </div>
        </ViewShell.TopBar>
      </Match>
    </Switch>
  );
}
