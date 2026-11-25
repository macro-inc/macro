import { EventRsvpChoice } from '@app/features/calendar/components/event-rsvp/EventRsvpChoice';
import { EventRsvpError } from '@app/features/calendar/components/event-rsvp/EventRsvpError';
import { EventRsvpRow } from '@app/features/calendar/components/event-rsvp/EventRsvpRow';
import { EventRsvpScope } from '@app/features/calendar/components/event-rsvp/EventRsvpScope';
import { EventRsvpStatus } from '@app/features/calendar/components/event-rsvp/EventRsvpStatus';
import { EventRsvpRoot } from '@app/features/calendar/context/event-rsvp-context';
import type { CalendarEvent } from '@app/features/calendar/types';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * RSVP controls for the connected account's own attendance.
 * Recurring responses retain the existing occurrence-or-series scope dialog.
 */
export function EventRsvpSection(props: {
  event: CalendarEvent;
  buttonSize?: 'sm' | 'md';
}) {
  return (
    <EventRsvpRoot event={props.event}>
      <EventRsvpRow class="border-edge-muted border-t bg-active px-4 py-2.5 text-sm text-ink-muted sm:text-xs mobile:border-0 mobile:bg-transparent mobile:px-6 mobile:pt-4 mobile:pb-2">
        <span class="flex shrink-0 items-center gap-2">
          {t('calendar.going')}
          <EventRsvpStatus />
        </span>
        <div class="ml-auto flex shrink-0 gap-3 lg:gap-2">
          <EventRsvpChoice
            response="accepted"
            size={isTouchDevice() ? 'sheet' : props.buttonSize}
          >
            {t('calendar.replyYes')}
          </EventRsvpChoice>
          <EventRsvpChoice
            response="tentative"
            size={isTouchDevice() ? 'sheet' : props.buttonSize}
          >
            {t('calendar.replyMaybe')}
          </EventRsvpChoice>
          <EventRsvpChoice
            response="declined"
            size={isTouchDevice() ? 'sheet' : props.buttonSize}
          >
            {t('calendar.replyNo')}
          </EventRsvpChoice>
        </div>
        <EventRsvpError />
      </EventRsvpRow>
      <EventRsvpScope />
    </EventRsvpRoot>
  );
}
