import { t } from '@app/lib/i18n';
import { CalendarSwatch } from '../../../components/calendar-swatch/CalendarSwatch';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { DEFAULT_CALENDAR_SOURCE } from '../../../types';

export function MobileComposerCompactTitle() {
  const model = useCalendarComposer();
  return (
    <div
      class="relative flex min-h-11 items-center justify-center gap-2 px-5"
      aria-hidden="true"
    >
      <CalendarSwatch
        compact
        color={
          model.controller.selectedCalendarOption()?.color ??
          DEFAULT_CALENDAR_SOURCE.color
        }
      />
      <span class="truncate text-[17px] font-semibold leading-[22px]">
        {model.state().title || t('calendar.newEvent')}
      </span>
      <div class="pointer-events-none absolute inset-x-0 top-full h-6 bg-linear-to-b from-menu to-transparent" />
    </div>
  );
}
