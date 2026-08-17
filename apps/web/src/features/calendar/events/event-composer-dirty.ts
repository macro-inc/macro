import {
  parseRecurrenceConfig,
  recurrenceConfigsEqual,
} from './recurrence-editor';

/** Form values that participate in event-composer dirty-state detection. */
export interface EventComposerFormSnapshot {
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  recurrenceLines: readonly string[];
  calendarId?: string;
  guestEmails: readonly string[];
  location: string;
  description: string;
}

function normalizedGuestEmails(emails: readonly string[]) {
  return emails.map((email) => email.trim().toLowerCase()).sort();
}

function arraysEqual(first: readonly string[], second: readonly string[]) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function recurrenceLinesEqual(
  first: readonly string[],
  second: readonly string[]
) {
  if (arraysEqual(first, second)) return true;

  const firstConfig = parseRecurrenceConfig([...first]);
  const secondConfig = parseRecurrenceConfig([...second]);
  return (
    firstConfig !== undefined &&
    secondConfig !== undefined &&
    recurrenceConfigsEqual(firstConfig, secondConfig)
  );
}

/** Whether the current composer values differ meaningfully from their baseline. */
export function isEventComposerFormDirty(
  initial: EventComposerFormSnapshot,
  current: EventComposerFormSnapshot
) {
  return (
    initial.title !== current.title ||
    initial.allDay !== current.allDay ||
    initial.start !== current.start ||
    initial.end !== current.end ||
    initial.calendarId !== current.calendarId ||
    initial.location !== current.location ||
    initial.description !== current.description ||
    !arraysEqual(
      normalizedGuestEmails(initial.guestEmails),
      normalizedGuestEmails(current.guestEmails)
    ) ||
    !recurrenceLinesEqual(initial.recurrenceLines, current.recurrenceLines)
  );
}
