import type { EventEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import { buildRecurrenceLines } from '@app/features/calendar/utils/recurrence';
import type { EmailThread } from '@app/features/email-thread/core/email-thread';
import { selectThreadMessages } from '@app/features/email-thread/core/thread-messages';
import { universalInputClient } from '@service-agent-harness/universal-input';

/** Well under the extractor's 16,000-character draft limit, leaving room for the subject. */
const MAX_BODY_CHARS = 12_000;

/**
 * The event the thread's latest message describes, read by the Command K
 * event extractor: its title, time, place and repeat rule. Guests stay the
 * thread's participants, which are exact where the extractor would guess.
 */
export async function suggestThreadEvent(
  thread: EmailThread,
  subject: string
): Promise<Partial<EventEditorInitialValues>> {
  const latest = selectThreadMessages(thread).filtered.at(-1);
  const body = (latest?.body_text ?? '').slice(0, MAX_BODY_CHARS);
  const response = await universalInputClient.extract(
    `${subject}\n\n${body}`,
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
