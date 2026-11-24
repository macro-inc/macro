import {
  useViewShell,
  ViewNavigationControls,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { CalendarViewTabs } from '@app/features/calendar/components/CalendarViewTabs';
import { MonthYearPickerPopover } from '@app/features/calendar/components/month-picker/MonthPickerPopover';
import { PeriodSelector } from '@app/features/calendar/components/PeriodSelector';
import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useCalendarHotkeys } from '@app/features/calendar/hooks/use-calendar-hotkeys';
import { useCalendarSearchUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { createLocalToday } from '@app/features/calendar/primitives/create-local-today';
import {
  calendarMonthLabel,
  calendarPeriodLabel,
} from '@app/features/calendar/utils/calendar-label';
import { CalendarSchedulingActions } from '@app/features/scheduling/calendar-actions';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { beginInteraction } from '@app/observability/flow';
import { calendarSearchRoute } from '@app/routes/routes';
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
import { createLabelCollapse } from '@core/signal/create-label-collapse';
import { fireAndForget } from '@core/util/fireAndForget';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { mergeRefs } from '@solid-primitives/refs';
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
import { MonthDrawer } from '../views/mobile/month-drawer';
import {
  CalendarCreateBookingLinkItem,
  CalendarCreateCallItem,
  CalendarCreateEventItem,
} from './CalendarCreateItems';
import { CalendarCreateMenu } from './CalendarCreateMenu';
import { CalendarSearch } from './CalendarSearch';

/** What the period controls give up, in order, when they would not fit their row. */
const CONTROLS_COLLAPSE_ORDER = ['todayLabel'] as const;

export function Header(props: {
  presentation: 'workspace' | 'preview';
  leading?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const navigate = useNavigate();
  const searchEnabled = useCalendarSearchUiFlag();
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
    })
  );
  // A narrow pane (the desktop window has no minimum width) shows Today as
  // its icon, then wraps Search below the other controls, then wraps those
  // too, rather than push any control past the pane's edge.
  const [controls, setControls] = createSignal<HTMLElement>();
  const collapsed = createLabelCollapse(
    controls,
    () => CONTROLS_COLLAPSE_ORDER,
    { watchContent: true }
  );
  const isCompactHeader = () => !breakpoints.fullHeader();
  const searchOverlaysControls = () => !breakpoints.inlineSearch();
  // A wrapped search field covers only its own row, not the date controls.
  const [periodControls, setPeriodControls] = createSignal<HTMLElement>();
  const controlsSize = createElementSize(controls);
  const periodControlsSize = createElementSize(periodControls);
  const searchOnOwnRow = () =>
    (controlsSize.height ?? 0) > (periodControlsSize.height ?? 0);
  const searchCoversControls = () =>
    searchOverlaysControls() && searchExpanded() && !searchOnOwnRow();
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
    focusGoToDate: false,
  });
  const goToDate = () => setMonthPicker({ open: true, focusGoToDate: true });
  const selectDate = (date: Date) => {
    const interaction = beginInteraction('calendar.date.jump');
    try {
      setMonthPicker({ open: false, focusGoToDate: false });
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
    goToDate,
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
          touch
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

  const previous = () => {
    return (
      <ButtonGroup.Button
        aria-label={`Previous ${periodLabel()}`}
        tooltip={{
          content: `Previous ${periodLabel()}`,
          hotkey: TOKENS.calendar.period.previous,
        }}
        variant="ghost"
        size="icon-md"
        class="border-transparent bg-transparent"
        onClick={navigation.previousPeriod}
      >
        <CaretLeftIcon class="size-4" />
      </ButtonGroup.Button>
    );
  };
  const next = () => {
    return (
      <ButtonGroup.Button
        aria-label={`Next ${periodLabel()}`}
        tooltip={{
          content: `Next ${periodLabel()}`,
          hotkey: TOKENS.calendar.period.next,
        }}
        variant="ghost"
        size="icon-md"
        class="border-transparent bg-transparent"
        onClick={navigation.nextPeriod}
      >
        <CaretRightIcon class="size-4" />
      </ButtonGroup.Button>
    );
  };
  const todayButton = (mobile: boolean) => {
    return (
      <Button
        aria-label="Go to today"
        tooltip={{
          content: 'Go to today',
          hotkey: TOKENS.calendar.period.today,
        }}
        variant="secondary"
        size={mobile ? 'icon-md' : 'md'}
        onClick={navigation.navigateToToday}
      >
        <Show when={mobile} fallback="Today">
          <span
            class="relative size-8 shrink-0 pointer-events-none"
            aria-hidden="true"
          >
            <CalendarBlankIcon class="size-8" />
            <span class="absolute inset-x-0 top-3.5 text-center text-xxs font-bold leading-none tabular-nums">
              {today().getDate()}
            </span>
          </span>
        </Show>
      </Button>
    );
  };
  return (
    <Switch>
      <Match when={usesTouchHeader()}>
        <TouchHeader>
          <TouchHeaderLeft>
            <HeaderIsland class="min-w-0 shrink px-1">
              <MonthDrawer
                month={currentDate()}
                showWeekends={calendarView.displaySettings.showWeekends}
              />
            </HeaderIsland>
          </TouchHeaderLeft>

          <TouchHeaderRight>
            <ViewShell.TopBarIsland class="size-10 justify-center p-0">
              {todayButton(true)}
            </ViewShell.TopBarIsland>
            <Show when={searchEnabled()}>
              <ViewShell.TopBarIsland class="size-10 justify-center p-0">
                <Button
                  variant="ghost"
                  size="icon-lg"
                  class="rounded-full"
                  aria-label={t('calendar.searchEvents')}
                  onClick={() =>
                    fireAndForget(
                      navigate({ route: calendarSearchRoute }),
                      'calendar-search'
                    )
                  }
                >
                  <SearchIcon class="size-5 mobile:size-6" />
                </Button>
              </ViewShell.TopBarIsland>
            </Show>
          </TouchHeaderRight>
        </TouchHeader>
      </Match>
      <Match when={!usesTouchHeader()}>
        <ViewShell.TopBar
          ref={setHeaderElement}
          navigation={false}
          class="h-auto min-h-12 flex-wrap items-start gap-x-2 not-touch:gap-y-4 py-2 [--view-search-height:2rem]"
        >
          <div
            class="relative flex min-w-0 flex-1 flex-wrap items-center gap-2"
            data-calendar-period-controls=""
            ref={mergeRefs(setControls, tourTarget(CALENDAR_TOUR.period))}
            onClick={() => setSearchExpanded(false)}
          >
            <ViewNavigationControls size="icon-md" />
            <div
              ref={setPeriodControls}
              class="flex grow flex-wrap items-center gap-2"
              classList={{
                invisible: searchCoversControls(),
                'pointer-events-none': searchCoversControls(),
              }}
            >
              {props.leading}
              <HeaderActionGroup label="Calendar navigation" size="md">
                {previous()}
                {next()}
              </HeaderActionGroup>
              {todayButton(collapsed('todayLabel'))}
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
            {/* In a narrow pane this slot wraps onto its own last row; the
                overlay hangs from the row box's bottom so it stays over it. */}
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
                    'absolute bottom-0 right-0 transition-[width] duration-200 ease-out motion-reduce:transition-none'
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
              <MonthYearPickerPopover
                value={currentDate()}
                open={monthPicker.open}
                focusGoToDate={monthPicker.focusGoToDate}
                onOpenChange={(open) =>
                  setMonthPicker({ open, focusGoToDate: false })
                }
                onChange={selectDate}
                onGoToDate={selectDate}
                showGoToDateHotkey
                triggerSize="md"
              >
                <span class="min-w-0 truncate text-xl font-semibold text-ink">
                  {calendarMonthLabel(currentDate())}
                </span>
                <CaretDownIcon class="size-3 text-ink-muted" />
              </MonthYearPickerPopover>
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
