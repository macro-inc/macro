import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import {
  eventDisplayTitle,
  eventForwardSummary,
} from '@app/features/calendar/utils/event-forward-summary';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import { fetchCalendarEventIcs } from '@queries/calendar/ics';
import { focusNewComposerTo } from './focus-new-composer';

/**
 * Opens a new email that passes the event on, as Gmail forwards an
 * invitation: no recipients, the title as subject, a summary in the body and
 * the event's `.ics` attached. Like Email guests, it closes the details
 * first, since closing hands focus back to the calendar chip and the
 * composer's To field has to win that exchange. Without the file there is
 * nothing to forward, so a failed fetch opens no composer and shows a toast,
 * as a failed Download .ics does.
 */
export function useForwardEventEmail() {
  const { openWithSplit } = useSplitLayout();

  return (
    event: CalendarEvent,
    options: { timeFormat: CalendarTimeFormat; closeDetails: () => void }
  ) =>
    Telemetry.span('calendar.forward_event', async (span) => {
      span.setAttr('calendar.event_id', event.eventId);
      options.closeDetails();
      // The composer mounts after the file arrives; the focus waits for it.
      focusNewComposerTo();
      const ics = await fetchCalendarEventIcs(event.eventId);
      if (ics.isErr()) {
        span.error('Calendar event .ics fetch failed');
        toast.failure('Failed to forward event');
        return;
      }
      span.setAttr('calendar.ics_bytes', ics.value.size);
      const title = eventDisplayTitle(event);
      openWithSplit(
        {
          type: 'component',
          id: 'email-compose',
          params: {
            initialSubject: title,
            initialBodyText: eventForwardSummary(event, options.timeFormat),
            initialAttachments: [
              new File([ics.value], `${title}.ics`, { type: 'text/calendar' }),
            ],
          },
          preserveParams: true,
        },
        // A composer already open holds another message; reusing it would
        // drop this one's subject, body and file.
        { preferNewSplit: true, allowDuplicate: true }
      );
    });
}
