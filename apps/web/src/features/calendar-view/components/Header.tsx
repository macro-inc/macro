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
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
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
import PhoneIcon from '@phosphor/phone.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useNavigate } from '@solidjs/router';
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

export function Header(props: { presentation: 'workspace' | 'preview' }) {
  const panel = useSplitPanelOrThrow();
  // PreviewFrame owns its own top bar and may sit inside another view shell.
  const shell = props.presentation === 'workspace' ? useViewShell() : undefined;
  const calendarPager = useCalendarPager();
  const pager = usePager<CalendarPageId>();
  const calendarView = useCalendarView();
  const openEventComposer = useOpenEventComposer();
  const navigate = useNavigate();
  const quickCalls = useQuickCallsFlag();
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
  const isNarrow = () => shell?.aside.isCollapsed() ?? true;

  const previous = () => (
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
  );
  const next = () => (
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
  );
  const newEvent = (compact: boolean) => (
    <Button
      variant="ghost"
      size="sm"
      class="shrink-0 gap-1 rounded-lg px-2 @max-[520px]/view-shell:size-7 @max-[520px]/view-shell:p-1 @max-[520px]/split-header:size-6 @max-[520px]/split-header:p-1 touch:rounded-full"
      label="New event"
      onClick={() => openEventComposer()}
    >
      <PlusIcon class="size-3.5" />
      <span
        class={
          compact
            ? '@max-[520px]/split-header:hidden'
            : '@max-[520px]/view-shell:hidden'
        }
      >
        New event
      </span>
    </Button>
  );
  const newCall = (compact: boolean) => (
    <Show when={quickCalls().enabled}>
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0 gap-1 rounded-lg px-2 @max-[520px]/view-shell:size-7 @max-[520px]/view-shell:p-1 @max-[520px]/split-header:size-6 @max-[520px]/split-header:p-1 touch:rounded-full"
        label="New Call"
        hotkey={TOKENS.create.call}
        onClick={() => {
          if (quickCalls().enabled) navigate('/meet/new');
        }}
      >
        <PhoneIcon class="size-3.5" />
        <span
          class={
            compact
              ? '@max-[520px]/split-header:hidden'
              : '@max-[520px]/view-shell:hidden'
          }
        >
          New Call
        </span>
      </Button>
    </Show>
  );
  const todayButton = (mobile: boolean) => (
    <Show when={mobile || !isTodayVisible()}>
      <Button
        variant={mobile ? 'ghost' : 'accent'}
        size={mobile ? 'icon-sm' : 'sm'}
        class={mobile ? 'relative rounded-full' : 'rounded-lg px-3'}
        label="Go to today"
        hotkey={TOKENS.calendar.period.today}
        onClick={calendarPager.navigateToToday}
      >
        <Show when={mobile} fallback="Today">
          <CalendarBlankIcon aria-hidden="true" />
          <span
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 flex items-center justify-center pt-1 text-[8px] font-bold leading-none"
          >
            {today().getDate()}
          </span>
        </Show>
      </Button>
    </Show>
  );

  return (
    <Show
      when={props.presentation === 'workspace' && !isTouchDevice()}
      fallback={
        <>
          <SplitHeaderLeft>
            <HeaderIsland class="shrink">
              <Show when={shell?.aside.isCollapsed()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="shrink-0 rounded-lg"
                  label="Show calendar navigation"
                  aria-expanded={shell?.aside.isOverlay() ?? false}
                  onClick={() => shell?.aside.expand()}
                >
                  <ListIcon class="size-5" />
                </Button>
              </Show>
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
                {todayButton(isMobile())}
                {newEvent(true)}
                {newCall(true)}
                <Show when={!isMobile()}>
                  <PeriodSelector isNarrow={isNarrow()} />
                  <div class="flex shrink-0 items-center gap-1">
                    {previous()}
                    {next()}
                  </div>
                </Show>
                <CalendarSearch />
                <CalendarSettingsDropdown isNarrow={isNarrow()} />
              </div>
            </HeaderIsland>
          </SplitHeaderRight>
        </>
      }
    >
      <ViewShell.TopBar class="gap-3 border-b border-edge-frame">
        <h1 class="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
          {dateTitle()}
        </h1>
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <CalendarSearch />
          {newEvent(false)}
          {newCall(false)}
          <CalendarSettingsDropdown isNarrow={isNarrow()} />
        </div>
      </ViewShell.TopBar>
      <ViewShell.Header class="py-3">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <PeriodSelector isNarrow={isNarrow()} />
          <div class="flex items-center gap-1">
            {previous()}
            {next()}
          </div>
          {todayButton(false)}
          <CopyAvailabilityButton class="ml-auto" />
        </div>
      </ViewShell.Header>
    </Show>
  );
}
