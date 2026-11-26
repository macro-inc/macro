import { formatLocale, t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  WheelColumn,
  WheelPicker,
} from '@components/app/mobile/wheel-picker/WheelPicker';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Button } from '@ui';
import { addDays, isWeekend } from 'date-fns';
import { createMemo, createSignal, Show } from 'solid-js';
import { useCalendarNavigation } from '../../../calendar/context/calendar-navigation-context';
import {
  createMonthWheelPicker,
  MONTH_WHEEL_FIRST_YEAR,
  MONTH_WHEEL_LAST_YEAR,
} from '../../../calendar/primitives/create-month-wheel-picker';

const YEAR_OPTIONS = Array.from(
  { length: MONTH_WHEEL_LAST_YEAR - MONTH_WHEEL_FIRST_YEAR + 1 },
  (_, index) => {
    const year = String(MONTH_WHEEL_FIRST_YEAR + index);
    return { value: year, label: year };
  }
);

/** A fresh wheel session starts at the first visible day each time the sheet opens. */
function MonthWheels(props: { month: Date; weekStart?: Date }) {
  const navigation = useCalendarNavigation();
  const months = createMemo(() => {
    const formatter = new Intl.DateTimeFormat(formatLocale(), {
      month: 'long',
    });
    return Array.from({ length: 12 }, (_, month) => ({
      value: String(month),
      label: formatter.format(new Date(2024, month, 1)),
    }));
  });
  const picker = createMonthWheelPicker(
    props.month,
    (date) => {
      const interaction = beginInteraction('calendar.date.jump');
      try {
        navigation.navigateToDate(date);
      } finally {
        interaction.end();
      }
    },
    props.weekStart
  );
  return (
    <div class="flex flex-col gap-3 px-5 pb-[max(26px,var(--mobile-sheet-safe-padding))]">
      <div class="rounded-3xl bg-panel p-1">
        <WheelPicker label={t('calendar.chooseMonth')}>
          <WheelColumn
            label={t('calendar.wheelMonth')}
            options={months()}
            value={String(picker.month())}
            onChange={(value) => picker.selectMonth(Number(value))}
            width={150}
            align="start"
            loop
          />
          <WheelColumn
            label={t('calendar.wheelYear')}
            options={YEAR_OPTIONS}
            value={String(picker.year())}
            onChange={(value) => picker.selectYear(Number(value))}
            width={72}
          />
        </WheelPicker>
      </div>
      <div class="pt-1">
        <MobileDrawer.Close
          as={Button}
          variant="secondary"
          size="sheet"
          fullWidth
          onClick={() => {
            picker.resetToToday();
            navigation.navigateToToday();
          }}
        >
          {t('calendar.today')}
        </MobileDrawer.Close>
      </div>
    </div>
  );
}

/** Phone month island and sheet; desktop keeps its separate month popover. */
export function MonthDrawer(props: { month: Date; showWeekends?: boolean }) {
  const navigation = useCalendarNavigation();
  const [open, setOpen] = createSignal(false);
  const firstVisibleDay = () => {
    const period = navigation.periodView();
    let day = props.month;
    if (period === 'timeGridWeek') day = navigation.weekRange()?.start ?? day;
    if (period === 'timeGridThreeDay')
      day = navigation.displayRange()?.start ?? day;
    if (
      props.showWeekends === false &&
      (period === 'timeGridWeek' || period === 'timeGridThreeDay')
    ) {
      while (isWeekend(day)) day = addDays(day, 1);
    }
    return day;
  };
  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={setOpen}
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus
    >
      <MobileDrawer.Trigger
        variant="ghost"
        as={Button}
        aria-label={t('calendar.chooseMonth')}
        class="max-w-full min-w-0 shrink justify-start gap-1 rounded-full border-none bg-transparent px-1 text-base font-semibold text-ink"
      >
        <span class="min-w-0 truncate">
          {new Intl.DateTimeFormat(formatLocale(), {
            month: 'long',
            year: 'numeric',
          }).format(firstVisibleDay())}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={t('calendar.chooseMonth')}
          class="pb-0!"
        >
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody class="pb-0!">
            <Show when={open()}>
              <MonthWheels
                month={firstVisibleDay()}
                weekStart={
                  navigation.periodView() === 'timeGridWeek'
                    ? firstVisibleDay()
                    : undefined
                }
              />
            </Show>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
