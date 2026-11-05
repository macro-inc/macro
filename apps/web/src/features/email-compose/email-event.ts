import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
} from '@app/features/calendar/components/composer/event-form-model';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { buildRecurrenceLines } from '@app/features/calendar/utils/recurrence';
import { useOpenEventComposer } from '@app/features/calendar-view/components/use-open-event-composer';
import { useUniversalInputEnabled } from '@app/features/universal-input/use-universal-input';
import { universalInputClient } from '@service-agent-harness/universal-input';
import { displaySubject, isPlaceholderSubject } from './core/subject-text';

/** Well under the extractor's 16,000-character draft limit, leaving room for the subject. */
const MAX_TEXT_CHARS = 12_000;

/**
 * The event an email describes, read by the Command K event extractor: its
 * title, time, place and repeat rule. Guests come from the email's addresses,
 * which are exact where the extractor would guess.
 */
export async function suggestEmailEvent(
  subject: string,
  text: string
): Promise<Partial<EventEditorInitialValues>> {
  const response = await universalInputClient.extract(
    `${subject}\n\n${text.slice(0, MAX_TEXT_CHARS)}`,
    'calendar',
    0
  );
  if (response.intent !== 'calendar') return {};
  const { title, start, end, location, recurrence } = response.suggestions;
  return {
    ...(title ? { title } : {}),
    ...(start && end ? { start, end } : {}),
    ...(location ? { location } : {}),
    ...(recurrence
      ? {
          recurrenceLines: buildRecurrenceLines(
            {
              frequency: recurrence.frequency,
              interval: recurrence.interval,
              byDay: recurrence.by_day,
              monthlyByDay: recurrence.monthly_by_day ?? undefined,
              ends: recurrence.ends,
            },
            false,
            Intl.DateTimeFormat().resolvedOptions().timeZone
          ),
        }
      : {}),
  };
}

/**
 * Opens the event composer for an email: the subject as the title and the
 * given addresses as guests at once, then the time and place the extractor
 * reads from `text`.
 */
export function useCreateEmailEvent() {
  const calendarEnabled = useCalendarUiFlag();
  const extractionEnabled = useUniversalInputEnabled();
  const openEventComposer = useOpenEventComposer();
  return {
    enabled: calendarEnabled,
    open(email: { subject: string; guests: string[]; text: string }) {
      if (!calendarEnabled()) return false;
      const shown = displaySubject(email.subject);
      const title = isPlaceholderSubject(shown) ? '' : shown;
      openEventComposer({
        suggestedValues: extractionEnabled()
          ? suggestEmailEvent(title, email.text)
          : undefined,
        initialValues: {
          // The composer settles the Macro call default once its flag loads.
          ...defaultEditorInitialValues(new Date(), true),
          title,
          guests: email.guests.join(', '),
        },
      });
      return true;
    },
  };
}
