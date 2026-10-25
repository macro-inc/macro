import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Button, CalendarMonthMenu, Dropdown, formatCalendarMonth } from '@ui';
import { createSignal, Match, Switch } from 'solid-js';
import { useCalendarPager } from './CalendarPagerContext';

type MonthDrawerProps = {
  month: Date;
};

/** Month selector that uses a dropdown on desktop and a drawer on touch. */
export function MonthDrawer(props: MonthDrawerProps) {
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

  const triggerContent = () => (
    <>
      <span class="min-w-0 truncate">{formatCalendarMonth(props.month)}</span>
      <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
    </>
  );

  return (
    <Switch>
      <Match when={isTouchDevice()}>
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
            class="max-w-full min-w-0 shrink justify-start gap-1 rounded-full border-none bg-transparent px-1 text-base font-semibold text-ink not-touch:hover:bg-hover"
          >
            {triggerContent()}
          </MobileDrawer.Trigger>

          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
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
      </Match>

      <Match when={!isTouchDevice()}>
        <Dropdown open={open()} onOpenChange={setOpen} placement="bottom-start">
          <Dropdown.Trigger
            aria-label="Choose month"
            class="max-w-full min-w-0 shrink justify-start gap-1 rounded-full border-none bg-transparent px-1 text-base font-semibold text-ink hover:bg-hover"
          >
            {triggerContent()}
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-40 p-1">
            <CalendarMonthMenu
              month={props.month}
              onChange={selectMonth}
              onToday={goToToday}
            />
          </Dropdown.Content>
        </Dropdown>
      </Match>
    </Switch>
  );
}
