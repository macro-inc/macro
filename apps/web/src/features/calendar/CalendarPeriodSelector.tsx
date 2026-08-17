import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSidePanel } from '@components/app/side-panel/SidePanel';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Dropdown, Hotkey, Calendar as MiniCalendar } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useCalendarPager } from './CalendarPagerContext';
import { useCalendarView } from './CalendarViewContext';
import { calendarPeriodLabel } from './calendar-label';
import type { CalendarPeriodView } from './events/types';

const CALENDAR_VIEWS = [
  {
    value: 'dayGridMonth',
    label: calendarPeriodLabel('dayGridMonth'),
    hotkeyToken: TOKENS.calendar.view.month,
  },
  {
    value: 'timeGridWeek',
    label: calendarPeriodLabel('timeGridWeek'),
    hotkeyToken: TOKENS.calendar.view.week,
  },
  {
    value: 'timeGridDay',
    label: calendarPeriodLabel('timeGridDay'),
    hotkeyToken: TOKENS.calendar.view.day,
  },
] satisfies Array<{
  value: CalendarPeriodView;
  label: string;
  hotkeyToken: HotkeyToken;
}>;

const DRAWER_ROW_CLASS =
  "relative flex w-full items-center gap-3 bg-surface px-4 py-3 text-left text-sm text-ink not-last:after:absolute not-last:after:inset-x-2 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-edge-muted not-last:after:content-['']";

function createCalendarPeriodControls(onSelect?: () => void) {
  const calendarView = useCalendarView();
  const calendarPager = useCalendarPager();
  const initialDate = new Date();
  const [pickerState, setPickerState] = createStore({
    open: false,
    month: initialDate,
    focusedDay: initialDate,
  });

  const currentDate = createMemo(
    () => calendarPager.activeDateInfo()?.view.calendar.getDate() ?? initialDate
  );

  const activeView = createMemo<CalendarPeriodView>(
    () =>
      (calendarPager.activeDateInfo()?.view.type as
        | CalendarPeriodView
        | undefined) ?? calendarView.displaySettings.periodView
  );

  const highlightedRange = createMemo(() => {
    const dateInfo = calendarPager.activeDateInfo();
    return dateInfo?.view.type === 'timeGridWeek'
      ? { end: dateInfo.end, start: dateInfo.start }
      : undefined;
  });

  const syncCustomDatePicker = () => {
    const date = currentDate();
    setPickerState({ month: date, focusedDay: date });
  };

  const setOpen = (open: boolean) => {
    if (open) syncCustomDatePicker();
    setPickerState('open', open);
  };

  const changeView = (view: CalendarPeriodView) => {
    setPickerState('open', false);
    onSelect?.();
    if (calendarPager.activeDateInfo()?.view.type === view) return;

    calendarPager.changeView(view);
  };

  const navigateCustomDateMonth = (month: Date) => {
    const focusedDay = pickerState.focusedDay;
    const targetDate =
      focusedDay.getFullYear() === month.getFullYear() &&
      focusedDay.getMonth() === month.getMonth()
        ? focusedDay
        : month;
    setPickerState({ month, focusedDay: targetDate });
  };

  const selectCustomDate = (date: Date | null) => {
    if (!date) return;

    setPickerState({ month: date, focusedDay: date, open: false });
    calendarPager.gotoDate(date);
    onSelect?.();
  };

  return {
    activeView,
    calendarView,
    changeView,
    currentDate,
    highlightedRange,
    navigateCustomDateMonth,
    pickerState,
    selectCustomDate,
    setFocusedDay: (date: Date) => setPickerState('focusedDay', date),
    setOpen,
    syncCustomDatePicker,
  };
}

type CalendarPeriodControls = ReturnType<typeof createCalendarPeriodControls>;

function CustomDatePicker(props: { controls: CalendarPeriodControls }) {
  const controls = props.controls;

  return (
    <MiniCalendar
      required
      fixedWeeks
      startOfWeek={controls.calendarView.displaySettings.weekStartsOn}
      value={controls.currentDate()}
      month={controls.pickerState.month}
      focusedDay={controls.pickerState.focusedDay}
      highlightedRange={controls.highlightedRange()}
      onMonthChange={controls.navigateCustomDateMonth}
      onFocusedDayChange={controls.setFocusedDay}
      onValueChange={controls.selectCustomDate}
    />
  );
}

/** Desktop calendar period selector and custom-date dropdown. */
export function CalendarPeriodSelector() {
  const sidePanel = useSidePanel();
  const controls = createCalendarPeriodControls();
  const isNarrow = () => sidePanel?.isNarrow() ?? false;

  return (
    <Dropdown
      open={controls.pickerState.open}
      onOpenChange={controls.setOpen}
      placement="bottom-end"
    >
      <Dropdown.Trigger
        depth={2}
        aria-label="Choose calendar view"
        size="sm"
        class="shrink-0 gap-1 rounded-lg border-edge-muted text-xs font-medium text-ink"
      >
        {CALENDAR_VIEWS.find((view) => view.value === controls.activeView())
          ?.label ?? 'Week'}
        <CaretDownIcon class="size-3 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-36">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={controls.activeView()}
            onChange={(view) => controls.changeView(view as CalendarPeriodView)}
          >
            <For each={CALENDAR_VIEWS}>
              {(view) => (
                <Dropdown.RadioItem closeOnSelect value={view.value}>
                  <span class="flex-1">{view.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>

                  <Hotkey token={view.hotkeyToken} theme="subtle" />
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
        <Show when={isNarrow()}>
          <Dropdown.Group>
            <Dropdown.Sub>
              <Dropdown.SubTrigger>
                <CalendarIcon class="size-3.5 text-ink-muted" />
                <span class="flex-1">Go to date</span>
                <CaretRightIcon class="size-3 text-ink-muted" />
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="w-72 max-w-[calc(100vw-1rem)]">
                <Dropdown.Group class="p-3">
                  <CustomDatePicker controls={controls} />
                </Dropdown.Group>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Period controls embedded in the mobile settings drawer. */
export function MobileCalendarPeriodControls(props: { onSelect: () => void }) {
  const controls = createCalendarPeriodControls(props.onSelect);

  return (
    <>
      <MobileDrawer.Label>Period</MobileDrawer.Label>
      <MobileDrawer.Section class="flex shrink-0 flex-col">
        <For each={CALENDAR_VIEWS}>
          {(view) => (
            <button
              type="button"
              class={DRAWER_ROW_CLASS}
              aria-pressed={controls.activeView() === view.value}
              onClick={() => controls.changeView(view.value)}
            >
              <span class="flex-1">{view.label}</span>
              <CheckIcon
                class="size-4 shrink-0 text-accent"
                classList={{
                  invisible: controls.activeView() !== view.value,
                }}
              />
            </button>
          )}
        </For>
      </MobileDrawer.Section>
      <div class="mt-4" />
    </>
  );
}
