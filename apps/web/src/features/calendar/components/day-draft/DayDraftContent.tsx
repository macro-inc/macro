import { t } from '@app/lib/i18n';
import type { EventContentArg } from '@fullcalendar/core';

/** The unsaved Day draft uses FullCalendar's own start/end resize controls. */
export function DayDraftContent(props: { renderProps: EventContentArg }) {
  return (
    <div class="calendar-day-draft-content flex h-full min-w-0 flex-col px-2 py-1 text-xs">
      <span class="truncate font-semibold">{t('calendar.newEvent')}</span>
      <span class="truncate">{props.renderProps.timeText}</span>
    </div>
  );
}
