import { formatLocale, t } from '@app/lib/i18n';
import CorvuCalendar from '@corvu/calendar';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Button } from '../Button';

export function CalendarRangeHeader() {
  const calendar = CorvuCalendar.useContext<'range'>();
  return (
    <div class="flex items-center gap-2">
      <CorvuCalendar.Label class="min-w-0 flex-1 text-sm font-medium">
        {new Intl.DateTimeFormat(formatLocale(), {
          month: 'long',
          year: 'numeric',
        }).format(calendar.month())}
      </CorvuCalendar.Label>
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <CorvuCalendar.Nav
          as={Button}
          variant="ghost"
          size="icon-sm"
          action="prev-month"
          aria-label={t('common.previousMonth')}
        >
          <CaretLeftIcon class="size-3" />
        </CorvuCalendar.Nav>
        <CorvuCalendar.Nav
          as={Button}
          variant="ghost"
          size="icon-sm"
          action="next-month"
          aria-label={t('common.nextMonth')}
        >
          <CaretRightIcon class="size-3" />
        </CorvuCalendar.Nav>
      </div>
    </div>
  );
}
