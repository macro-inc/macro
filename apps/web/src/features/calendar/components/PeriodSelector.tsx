import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import {
  Button,
  ButtonGroup,
  Dropdown,
  Hotkey,
  Calendar as MiniCalendar,
} from '@ui';
import { createMemo, createUniqueId, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useCalendarNavigation } from '../context/calendar-navigation-context';
import { CALENDAR_PERIODS } from '../core/periods';
import type { CalendarPeriodView } from '../types';
import { calendarPeriodLabel } from '../utils/calendar-label';
import { useCalendarView } from './CalendarViewContext';

const VIEW_HOTKEYS: Partial<Record<CalendarPeriodView, HotkeyToken>> = {
  timeGridDay: TOKENS.calendar.view.day,
  timeGridWeek: TOKENS.calendar.view.week,
  dayGridMonth: TOKENS.calendar.view.month,
};

const calendarViews = () =>
  CALENDAR_PERIODS.map((value) => ({
    value,
    label: calendarPeriodLabel(value),
    hotkeyToken: VIEW_HOTKEYS[value],
  }));

function createCalendarPeriodControls(onSelect?: () => void) {
  const calendarView = useCalendarView();
  const navigation = useCalendarNavigation();
  const initialDate = new Date();
  const [pickerState, setPickerState] = createStore({
    open: false,
    month: initialDate,
    focusedDay: initialDate,
  });

  const currentDate = createMemo(() => navigation.activeDate() ?? initialDate);

  const activeView = navigation.periodView;

  const highlightedRange = createMemo(navigation.weekRange);

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
    if (navigation.periodView() === view) return;

    navigation.changeView(view);
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
    navigation.gotoDate(date);
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
export function PeriodSelector(props: {
  isNarrow?: boolean;
  compact?: boolean;
  grouped?: boolean;
}) {
  const controls = createCalendarPeriodControls();

  return (
    <Dropdown
      open={controls.pickerState.open}
      onOpenChange={controls.setOpen}
      placement="bottom-end"
    >
      <Dropdown.Trigger
        as={props.grouped ? ButtonGroup.Button : Button}
        aria-label={t('calendar.viewLabel')}
        variant="ghost"
        size={props.grouped ? undefined : props.compact ? 'md' : 'lg'}
        class="shrink-0 border-transparent bg-transparent text-sm"
      >
        {calendarViews().find((view) => view.value === controls.activeView())
          ?.label ?? t('calendar.viewWeek')}
        <CaretDownIcon class="size-4 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-36">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={controls.activeView()}
            onChange={(view) => controls.changeView(view as CalendarPeriodView)}
          >
            <For each={calendarViews()}>
              {(view) => (
                <Dropdown.RadioItem closeOnSelect value={view.value}>
                  <span class="flex-1">{view.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>

                  <Show when={view.hotkeyToken}>
                    {(token) => <Hotkey token={token()} theme="subtle" />}
                  </Show>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
        <Show when={props.isNarrow}>
          <Dropdown.Group>
            <Dropdown.Sub>
              <Dropdown.SubTrigger>
                <CalendarIcon class="size-3.5 text-ink-muted" />
                <span class="flex-1">{t('calendar.goToDate')}</span>
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
export function MobilePeriodControls(props: { onSelect: () => void }) {
  const controls = createCalendarPeriodControls(props.onSelect);
  const labelId = createUniqueId();

  return (
    <>
      <MobileDrawer.Label id={labelId}>
        {t('calendar.periodLabel')}
      </MobileDrawer.Label>
      <MobileDrawer.Section
        role="radiogroup"
        aria-labelledby={labelId}
        class="flex shrink-0 flex-col"
      >
        <For each={calendarViews()}>
          {(view) => (
            <MobileFilterDrawer.Option
              selectionMode="single"
              checked={controls.activeView() === view.value}
              onChange={() => controls.changeView(view.value)}
            >
              {view.label}
            </MobileFilterDrawer.Option>
          )}
        </For>
      </MobileDrawer.Section>
      <div class="mt-4" />
    </>
  );
}
