import { t } from '@app/lib/i18n';
import { SheetRow } from '@components/app/mobile/SheetRow';
import { CalendarSwatch } from '../../../components/CalendarSwatch';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function MobileComposerCompactTitle(props: { progress: number }) {
  const model = useCalendarComposer();
  return (
    <div
      data-composer-compact-title
      class="pointer-events-none absolute inset-x-0 top-0 bg-[var(--composer-title-surface,var(--color-menu))] px-5 opacity-0 [transform:translateY(var(--composer-title-offset))] motion-reduce:transform-none motion-reduce:transition-opacity motion-reduce:duration-75"
      style={{
        '--composer-title-offset': `${(1 - props.progress) * 6}px`,
        opacity: props.progress,
      }}
      aria-hidden="true"
    >
      <div class="p-1">
        <SheetRow icon={<CalendarSwatch color={model.calendarColor()} />}>
          <span class="block truncate text-left text-xl font-semibold leading-[26px]">
            {model.state().title || t('calendar.newEvent')}
          </span>
        </SheetRow>
      </div>
      <div class="absolute inset-x-0 top-full h-6 bg-linear-to-b from-[var(--composer-title-surface,var(--color-menu))] to-transparent" />
    </div>
  );
}
