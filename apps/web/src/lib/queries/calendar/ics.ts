import { storageServiceClient } from '@service-storage/client';

/** The iCalendar file of an event the viewer can see. */
export async function fetchCalendarEventIcs(eventId: string) {
  return (await storageServiceClient.getCalendarEventIcs(eventId)).map(
    (bytes) => new Blob([bytes], { type: 'text/calendar' })
  );
}
