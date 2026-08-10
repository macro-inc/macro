import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Button, CalendarMonthMenu, formatCalendarMonth } from '@ui';
import { createSignal } from 'solid-js';
import { useCalendarPager } from './CalendarPagerContext';

type CalendarMonthDrawerProps = {
  month: Date;
};

/** Drawer presentation for navigating the calendar to a month. */
export function CalendarMonthDrawer(props: CalendarMonthDrawerProps) {
  const calendarPager = useCalendarPager();
  const [open, setOpen] = createSignal(false);

  const selectMonth = (month: Date) => {
    setOpen(false);
    calendarPager.navigateToDate(month);
  };

  const goToToday = () => {
    setOpen(false);
    calendarPager.navigateToToday();
  };

  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={setOpen}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Trigger
        as={Button}
        aria-label="Choose month"
        class="max-w-full min-w-0 justify-start gap-1 rounded-full border-none bg-transparent px-1 text-base font-semibold text-ink hover:bg-hover"
      >
        <span class="min-w-0 truncate">{formatCalendarMonth(props.month)}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </MobileDrawer.Trigger>

      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Choose month">
          <MobileDrawer.Handle />
          <MobileDrawer.Section class="mb-3 overflow-visible">
            <CalendarMonthMenu
              month={props.month}
              presentation="radio-group"
              onChange={selectMonth}
              onToday={goToToday}
            />
          </MobileDrawer.Section>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
