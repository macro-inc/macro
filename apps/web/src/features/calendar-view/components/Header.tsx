import { useViewShell, ViewShell } from '@app/components/view-shell';
import { CopyAvailabilityButton } from '@app/features/calendar/availability/CopyAvailabilityButton';
import {
  type CalendarPageId,
  useCalendarPager,
} from '@app/features/calendar/components/CalendarPagerContext';
import { CalendarSettingsDropdown } from '@app/features/calendar/components/CalendarSettingsDropdown';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { MonthDrawer } from '@app/features/calendar/components/MonthDrawer';
import { PeriodSelector } from '@app/features/calendar/components/PeriodSelector';
import { useCalendarHotkeys } from '@app/features/calendar/hooks/use-calendar-hotkeys';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
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
import { Button, cn } from '@ui';
import { usePager } from '@ui/components/Pager';
import {
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import {
  CalendarCreateCallItem,
  CalendarCreateEventItem,
  CalendarCreateReminderItem,
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

export function Header(props: { presentation: 'workspace' | 'preview' }) {
  const panel = useSplitPanelOrThrow();
  // PreviewFrame owns its own top bar and may sit inside another view shell.
  const shell = props.presentation === 'workspace' ? useViewShell() : undefined;
  const calendarPager = useCalendarPager();
  const pager = usePager<CalendarPageId>();
  const calendarView = useCalendarView();
  const initialDate = new Date();
  const [headerElement, setHeaderElement] = createSignal<HTMLElement>();
  const paneSize = createElementSize(() =>
    headerElement()?.closest<HTMLElement>('[data-view-shell-main]')
  );
  // Measure the parent pane so toolbar content cannot affect its own breakpoint.
  // A docked sidebar owns New and hides the navigation toggle, so its toolbar
  // fits sooner. Avoid wrapping just before the sidebar collapses and unwraps it.
  const hasDockedSidebar = () =>
    !!shell && !shell.aside.isCollapsed() && !shell.aside.isOverlay();
  const breakpoints = createSizeBreakpoints(
    () => paneSize.width ?? 0,
    () => ({
      fullHeader: { min: hasDockedSidebar() ? 480 : 600 },
      inlineSearch: { min: 1040 },
      labeledNew: { min: 360 },
      labeledToday: { min: 304 },
    })
  );
  const isCompactHeader = () => !breakpoints.fullHeader();
  const searchOverlaysTitle = () => !breakpoints.inlineSearch();
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
    if (event.target === event.currentTarget && event.propertyName === 'width') {
      finishSearchExpansion();
    }
  };
  onCleanup(clearSearchExpansionTimer);
  useCalendarHotkeys({
    scopeId: panel.splitHotkeyScope,
    changeView: calendarPager.changeView,
    previousPeriod: pager.previous,
    nextPeriod: pager.next,
    navigateToToday: calendarPager.navigateToToday,
  });

  const currentDate = createMemo(
    () => calendarPager.activeDateInfo()?.view.calendar.getDate() ?? initialDate
  );
  const dateTitle = createMemo(() => formatMonthTitle(currentDate()));
  const periodLabel = createMemo(() =>
    calendarPeriodLabel(calendarView.displaySettings.periodView).toLowerCase()
  );
  const isNarrow = () => shell?.aside.isCollapsed() ?? true;
  const showHeaderCreate = () =>
    isCompactHeader() ||
    (shell?.aside.isCollapsed() && !shell?.aside.isOverlay());
  const usesSplitHeader = () =>
    props.presentation === 'preview' || isTouchDevice();
  const createItems = () => (
    <>
      <CalendarCreateEventItem />
      <CalendarCreateCallItem />
      <CalendarCreateReminderItem />
    </>
  );
  const headerCreateMenu = () => (
    <CalendarCreateMenu
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

  const previous = () => (
    <Button
      variant="ghost"
      size="icon-lg"
      class="border-transparent bg-transparent"
      label={`Previous ${periodLabel()}`}
      hotkey={TOKENS.calendar.period.previous}
      onClick={() => void pager.previous()}
    >
      <CaretLeftIcon class="size-5" />
    </Button>
  );
  const next = () => (
    <Button
      variant="ghost"
      size="icon-lg"
      class="border-transparent bg-transparent"
      label={`Next ${periodLabel()}`}
      hotkey={TOKENS.calendar.period.next}
      onClick={() => void pager.next()}
    >
      <CaretRightIcon class="size-5" />
    </Button>
  );
  const todayButton = (mobile: boolean) => (
    <Button
      variant={mobile ? 'ghost' : 'outline'}
      size={mobile ? 'icon-lg' : 'lg'}
      class={cn(
        mobile && 'relative',
        !mobile && 'border-edge-button bg-transparent px-3 text-sm'
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
            <div class="flex items-center gap-1">
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
          class="@container/calendar-toolbar h-auto min-h-12 flex-wrap gap-x-2 gap-y-2 py-2"
        >
          <div class="relative flex min-w-0 flex-1 items-center gap-2">
            <h1
              class="min-w-0 truncate text-[clamp(1rem,calc(0.75rem+1cqw),1.5rem)] font-semibold leading-tight tracking-[-0.03em] text-ink transition-opacity duration-150 motion-reduce:transition-none"
              classList={{
                'opacity-0': searchOverlaysTitle() && searchExpanded(),
              }}
            >
              {dateTitle()}
            </h1>
            <div
              onTransitionEnd={handleSearchTransitionEnd}
              class={cn(
                'ml-auto h-10 shrink-0',
                searchOverlaysTitle()
                  ? 'w-10'
                  : 'transition-[width] duration-200 ease-out motion-reduce:transition-none'
              )}
              style={
                searchOverlaysTitle()
                  ? undefined
                  : {
                      width: searchExpanded()
                        ? 'clamp(22rem, 40cqw, 28rem)'
                        : '2.5rem',
                    }
              }
            >
              <div
                onTransitionEnd={handleSearchTransitionEnd}
                class={cn(
                  'h-10',
                  searchOverlaysTitle() &&
                    'absolute right-0 top-0 transition-[width] duration-200 ease-out motion-reduce:transition-none'
                )}
                style={
                  searchOverlaysTitle()
                    ? {
                        width: searchExpanded() ? 'min(100%, 28rem)' : '2.5rem',
                      }
                    : undefined
                }
              >
                <CalendarSearch
                  inline
                  compact={searchOverlaysTitle()}
                  expanded={searchExpanded()}
                  popupReady={searchPopupReady()}
                  onExpand={() => setSearchExpanded(true)}
                  onDismiss={() => setSearchExpanded(false)}
                />
              </div>
            </div>
          </div>
          <div
            class={cn(
              'flex shrink-0 items-center justify-end gap-1',
              isCompactHeader() ? 'basis-full' : 'ml-4'
            )}
            data-calendar-period-controls=""
            onClick={() => setSearchExpanded(false)}
          >
            <Show when={showHeaderCreate()}>
              <div classList={{ 'mr-auto': isCompactHeader() }}>
                {headerCreateMenu()}
              </div>
            </Show>
            {todayButton(!breakpoints.labeledToday())}
            <PeriodSelector isNarrow={isNarrow()} />
            {previous()}
            {next()}
          </div>
        </ViewShell.TopBar>
      </Match>
    </Switch>
  );
}
