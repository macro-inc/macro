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
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ListIcon from '@phosphor/list.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { usePager } from '@ui/components/Pager';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { CalendarCreateMenu } from './CalendarCreateMenu';
import { CalendarSearch } from './CalendarSearch';
import { useOpenEventComposer } from './use-open-event-composer';

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
  const openEventComposer = useOpenEventComposer();
  const initialDate = new Date();
  const [headerElement, setHeaderElement] = createSignal<HTMLElement>();
  const headerSize = createElementSize(headerElement);
  // The shell width includes the sidebar; only the header's main-pane width matters.
  const isCompactHeader = () => (headerSize.width ?? 0) < 520;
  const showPeriodControls = () => (headerSize.width ?? 0) >= 460;
  const showNavigationArrows = () => (headerSize.width ?? 0) >= 260;
  const today = createLocalToday();
  const [narrowSearchOpen, setNarrowSearchOpen] = createSignal(false);
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

  const previous = () => (
    <Button
      variant="ghost"
      size="icon-lg"
      class="rounded-full border-transparent bg-transparent"
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
      class="rounded-full border-transparent bg-transparent"
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
      class={
        mobile
          ? 'relative rounded-full'
          : 'rounded-full border-edge-button bg-transparent px-3 text-sm'
      }
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
    <Show
      when={props.presentation === 'workspace' && !isTouchDevice()}
      fallback={
        <>
          <SplitHeaderLeft>
            <HeaderIsland class="min-w-0 shrink px-1">
              <Show when={!isMobile() && shell?.aside.isCollapsed()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="shrink-0 rounded-full"
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
                  iconOnly
                  onCreateEvent={() => openEventComposer()}
                />
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
                  <CopyAvailabilityButton iconOnly largeIcon />
                </Show>
                <CalendarSearch />
                <Show when={props.presentation === 'preview' || isMobile()}>
                  <CalendarSettingsDropdown isNarrow={isNarrow()} />
                </Show>
              </div>
            </HeaderIsland>
          </SplitHeaderRight>
        </>
      }
    >
      <>
        <ViewShell.TopBar class="py-2">
          <h1 class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
            {dateTitle()}
          </h1>
          <Show when={isCompactHeader()}>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <CalendarCreateMenu
                header
                onCreateEvent={() => openEventComposer()}
              />
            </div>
          </Show>
          <Show
            when={
              !isCompactHeader() &&
              shell?.aside.isCollapsed() &&
              !shell?.aside.isOverlay()
            }
          >
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <CalendarCreateMenu
                header
                onCreateEvent={() => openEventComposer()}
              />
            </div>
          </Show>
        </ViewShell.TopBar>
        <ViewShell.Header ref={setHeaderElement}>
          <div class="flex h-10 min-w-0 items-center gap-2">
            <div class="min-w-0 max-w-md flex-1">
              <CalendarSearch
                inline
                compact={isCompactHeader()}
                onOpenChange={setNarrowSearchOpen}
              />
            </div>
            <Show
              when={
                (!isCompactHeader() || !narrowSearchOpen()) &&
                showNavigationArrows()
              }
            >
              <div class="ml-auto flex shrink-0 items-center gap-1">
                <Show when={showPeriodControls()}>
                  {todayButton(false)}
                  <PeriodSelector isNarrow={isNarrow()} />
                </Show>
                {previous()}
                {next()}
              </div>
            </Show>
          </div>
        </ViewShell.Header>
      </>
    </Show>
  );
}
