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
import { useSidePanel } from '@components/app/side-panel/SidePanel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button } from '@ui';
import { usePager } from '@ui/components/Pager';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
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

export function Header() {
  const panel = useSplitPanelOrThrow();
  const sidePanel = useSidePanel();
  const calendarPager = useCalendarPager();
  const pager = usePager<CalendarPageId>();
  const calendarView = useCalendarView();
  const openEventComposer = useOpenEventComposer();
  const initialDate = new Date();
  const today = createLocalToday();

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
  const visibleRange = createMemo(() => {
    const dateInfo = calendarPager.activeDateInfo();
    return dateInfo ? { end: dateInfo.end, start: dateInfo.start } : undefined;
  });
  const isTodayVisible = createMemo(() => {
    const range = visibleRange();
    if (!range) return true;

    const currentDay = today();
    return currentDay >= range.start && currentDay < range.end;
  });

  return (
    <>
      <SplitHeaderLeft>
        <HeaderIsland class="shrink">
          <Show
            when={isMobile()}
            fallback={
              <>
                <span class="min-w-0 truncate text-base font-semibold text-ink">
                  {dateTitle()}
                </span>
                <CopyAvailabilityButton class="ml-2" />
              </>
            }
          >
            <MonthDrawer month={currentDate()} />
          </Show>
        </HeaderIsland>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <HeaderIsland class="px-1">
          <div class="flex items-center gap-1">
            <Show
              when={isMobile()}
              fallback={
                <Show when={!isTodayVisible()}>
                  <Button
                    variant="accent"
                    size="sm"
                    class="rounded-lg px-3"
                    depth={2}
                    label="Go to today"
                    hotkey={TOKENS.calendar.period.today}
                    onClick={calendarPager.navigateToToday}
                  >
                    Today
                  </Button>
                </Show>
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-full"
                label="Go to today"
                hotkey={TOKENS.calendar.period.today}
                onClick={calendarPager.navigateToToday}
              >
                <CalendarBlankIcon aria-hidden="true" />
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-0 flex items-center justify-center pt-1 text-[8px] font-bold leading-none"
                >
                  {today().getDate()}
                </span>
              </Button>
            </Show>
            <Show when={!isMobile()}>
              <Button
                variant="ghost"
                size="sm"
                class="rounded-lg px-2"
                onClick={() => openEventComposer()}
              >
                <PlusIcon class="size-3.5" />
                New event
              </Button>
              <PeriodSelector isNarrow={sidePanel?.isNarrow()} />
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="rounded-lg"
                  label={`Previous ${periodLabel()}`}
                  hotkey={TOKENS.calendar.period.previous}
                  onClick={() => void pager.previous()}
                >
                  <CaretLeftIcon class="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="rounded-lg"
                  label={`Next ${periodLabel()}`}
                  hotkey={TOKENS.calendar.period.next}
                  onClick={() => void pager.next()}
                >
                  <CaretRightIcon class="size-4" />
                </Button>
              </div>
            </Show>
            <CalendarSearch />
            <CalendarSettingsDropdown isNarrow={sidePanel?.isNarrow()} />
          </div>
        </HeaderIsland>
      </SplitHeaderRight>
    </>
  );
}
