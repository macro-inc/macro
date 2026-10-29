import type { CalendarEvent } from '@app/features/calendar/types';
import { eventDisplayTitle } from '@app/features/calendar/utils/event-forward-summary';
import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
import { fetchCalendarEventIcs } from '@queries/calendar/ics';

/** Save an event as an `.ics` file named after its title. */
export async function downloadCalendarEventIcs(
  event: Pick<CalendarEvent, 'eventId' | 'title'>
) {
  const file = await fetchCalendarEventIcs(event.eventId);
  if (file.isErr()) {
    toast.failure('Failed to download event');
    return;
  }
  await downloadFile(file.value, `${eventDisplayTitle(event)}.ics`);
}
