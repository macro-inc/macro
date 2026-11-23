import CorvuCalendar from '@corvu/calendar';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button, cn } from '@ui';
import { Index } from 'solid-js';

export function WhenMonthGrid(props: {
  size: 'desktop' | 'phone';
  locale: string;
}) {
  const calendar = CorvuCalendar.useContext();
  const compact = () => props.size === 'desktop';
  const month = () =>
    new Intl.DateTimeFormat(props.locale, {
      month: 'long',
      year: 'numeric',
    }).format(calendar.month());
  return (
    <div data-when-month="" class={compact() ? 'w-[252px]' : 'w-[266px]'}>
      <div
        class={cn(
          'flex items-center justify-between gap-1',
          compact() ? 'h-7 pl-2 pr-1 text-sm' : 'min-h-11 text-base'
        )}
      >
        <CorvuCalendar.Label class="font-semibold">
          {month()}
        </CorvuCalendar.Label>
        <div class="flex">
          <CorvuCalendar.Nav
            as={Button}
            variant="ghost"
            size={compact() ? 'icon-xs' : 'icon-md'}
            action="prev-month"
            aria-label="Go to previous month"
          >
            <CaretLeftIcon class="size-3" />
          </CorvuCalendar.Nav>
          <CorvuCalendar.Nav
            as={Button}
            variant="ghost"
            size={compact() ? 'icon-xs' : 'icon-md'}
            action="next-month"
            aria-label="Go to next month"
          >
            <CaretRightIcon class="size-3" />
          </CorvuCalendar.Nav>
        </div>
      </div>
      <CorvuCalendar.Table class="w-full table-fixed border-collapse">
        <thead>
          <tr>
            <Index each={calendar.weekdays()}>
              {(day) => (
                <CorvuCalendar.HeadCell
                  class={cn(
                    'text-center text-xs text-ink-extra-muted',
                    compact() ? 'h-[22px]' : 'h-6'
                  )}
                  abbr={new Intl.DateTimeFormat(props.locale, {
                    weekday: 'long',
                  }).format(day())}
                >
                  {new Intl.DateTimeFormat(props.locale, {
                    weekday: 'narrow',
                  }).format(day())}
                </CorvuCalendar.HeadCell>
              )}
            </Index>
          </tr>
        </thead>
        <tbody>
          <Index each={calendar.weeks()}>
            {(week) => (
              <tr>
                <Index each={week()}>
                  {(day) => (
                    <CorvuCalendar.Cell
                      class={cn(
                        'p-0 text-center',
                        compact() ? 'h-[30px]' : 'h-10'
                      )}
                    >
                      <CorvuCalendar.CellTrigger
                        day={day()}
                        month={calendar.month()}
                        class={cn(
                          'mx-auto flex items-center justify-center rounded-full outline-none text-ink data-today:text-accent data-today:font-semibold data-selected:bg-accent! data-selected:text-button-accent-ink! data-range-start:bg-accent! data-range-start:text-button-accent-ink! data-range-end:bg-accent! data-range-end:text-button-accent-ink! data-in-range:bg-selected hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:text-ink-disabled disabled:pointer-events-none',
                          compact() ? 'size-7 text-xs' : 'size-9 text-base',
                          day().getMonth() !== calendar.month().getMonth() &&
                            'text-ink-disabled',
                          (day().getDay() === 0 || day().getDay() === 6) &&
                            'text-ink-muted'
                        )}
                      >
                        {day().getDate()}
                      </CorvuCalendar.CellTrigger>
                    </CorvuCalendar.Cell>
                  )}
                </Index>
              </tr>
            )}
          </Index>
        </tbody>
      </CorvuCalendar.Table>
    </div>
  );
}
