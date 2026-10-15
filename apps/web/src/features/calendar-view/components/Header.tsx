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
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ListIcon from '@icon/system/regular/list.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { CALENDAR_TOUR } from '../tour';
import {
  CalendarCreateBookingLinkItem,
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

export function Header(props: { presentation: 'workspace' | 'preview' }) {
  const panel = useSplitPanelOrThrow();
  // PreviewFrame owns its own top bar and may sit inside another view shell.
  const shell = props.presentation === 'workspace' ? useViewShell() : undefined;
  const calendarPager = useCalendarPager();
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
      fullHeader: { min: hasDockedSidebar() ? 620 : 680 },
      labeledNew: { min: 360 },
      labeledToday: { min: 304 },
    })
  );
  const isCompactHeader = () => !breakpoints.fullHeader();
  const today = createLocalToday();
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
  const usesSplitHeader = () =>
    props.presentation === 'preview' || isTouchDevice();
  const createItems = () => (
    <>
      <CalendarCreateEventItem />
      <CalendarCreateCallItem />
      <CalendarCreateBookingLinkItem />
    </>
  );
  const previous = () => (
    <Button
      variant="ghost"
      size="icon-lg"
      class="size-8 rounded-lg border-transparent bg-transparent touch:size-11"
      label={`Previous ${periodLabel()}`}
      hotkey={TOKENS.calendar.period.previous}
      onClick={calendarPager.previousPeriod}
    >
      <CaretLeftIcon class="size-4" />
    </Button>
  );
  const next = () => (
    <Button
      variant="ghost"
      size="icon-lg"
      class="size-8 rounded-lg border-transparent bg-transparent touch:size-11"
      label={`Next ${periodLabel()}`}
      hotkey={TOKENS.calendar.period.next}
      onClick={calendarPager.nextPeriod}
    >
      <CaretRightIcon class="size-4" />
    </Button>
  );
  const todayButton = (mobile: boolean) => (
    <Button
      variant="ghost"
      size={mobile ? 'icon-lg' : 'lg'}
      class={cn(
        mobile && 'relative',
        !mobile &&
          'h-8 rounded-lg border-transparent bg-transparent px-3 text-sm'
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
            <CalendarSettingsDropdown isNarrow={isNarrow()} />
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
              <CalendarSchedulingActions />
            </div>
          </HeaderIsland>
        </SplitHeaderRight>
      </Match>
      <Match when={!usesSplitHeader()}>
        <ViewShell.TopBar
          controls={
            <div class="flex shrink-0 items-center gap-1">
              <div
                class="flex shrink-0 items-center gap-0.5"
                role="group"
                aria-label="Calendar date navigation"
                data-calendar-period-controls=""
                ref={tourTarget(CALENDAR_TOUR.period)}
              >
                {previous()}
                {todayButton(!breakpoints.labeledToday())}
                {next()}
              </div>
              <PeriodSelector isNarrow={isNarrow()} />
              <span aria-hidden="true" class="mx-2 h-4 w-px bg-edge-divider" />
              <CalendarSettingsDropdown isNarrow={isNarrow()} />
              <Show when={!hasDockedSidebar()}>
                <CalendarSchedulingActions />
              </Show>
            </div>
          }
          workspaceActions
          ref={setHeaderElement}
          class={cn(
            '[&_[data-workspace-controls]_button]:h-8 [&_[data-workspace-controls]_button]:min-h-8',
            isCompactHeader() && 'h-auto min-h-12 py-2'
          )}
        >
          <div
            class={cn(
              'flex min-w-0 items-center gap-5',
              isCompactHeader() ? 'basis-full' : 'flex-1'
            )}
          >
            <h1 class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
              {dateTitle()}
            </h1>
          </div>
        </ViewShell.TopBar>
      </Match>
    </Switch>
  );
}
