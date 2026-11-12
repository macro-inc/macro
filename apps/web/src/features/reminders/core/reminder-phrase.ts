import {
  instantAtWallClock,
  localWallClock,
} from '@core/natural-time/wall-clock';
import type {
  NaturalTimeError,
  NaturalTimeMoment,
  NaturalTimeOutcome,
  NaturalTimeWasmModule,
} from '@core/natural-time/wasm-module';
import { match } from 'ts-pattern';
import { REMINDER_DEFAULT_TIME } from '../reminder-schedule';
import type { ReminderTimeOption } from './email-reminder';

type PhraseReader = Pick<NaturalTimeWasmModule, 'read' | 'readOtherMeridiem'>;

/** The times a typed phrase offers, or why it offers none. */
export type ReminderPhraseReading =
  | { kind: 'read'; options: ReminderTimeOption[] }
  | { kind: 'unread'; reason: string };

/** Dates written without a time remind when the Tomorrow preset does. */
const DEFAULT_TIME = [
  REMINDER_DEFAULT_TIME.hours,
  REMINDER_DEFAULT_TIME.minutes,
]
  .map((part) => String(part).padStart(2, '0'))
  .join(':');

/**
 * Reads `phrase` as when a reminder shows up, at `now` in the browser's time
 * zone. A guessed am or pm also offers the other half of the day, after the
 * guess. Times that have passed or that daylight saving skips are never
 * offered.
 */
export function readReminderPhrase(
  reader: PhraseReader,
  phrase: string,
  now: Date
): ReminderPhraseReading {
  const wallClock = localWallClock(now);
  const guess = reader.read(phrase, wallClock, 'start', DEFAULT_TIME);
  if (guess.outcome === 'unread') {
    return { kind: 'unread', reason: unreadReason(guess.error) };
  }

  const readings: NaturalTimeOutcome[] = [guess];
  if (guess.assumed.meridiem) {
    readings.push(
      reader.readOtherMeridiem(phrase, wallClock, 'start', DEFAULT_TIME)
    );
  }

  const label = phrase.trim();
  const options: ReminderTimeOption[] = [];
  for (const reading of readings) {
    if (reading.outcome === 'unread') continue;
    const date = instantOf(reading.start, now);
    if (!date || date.getTime() <= now.getTime()) continue;
    if (options.some((option) => option.date.getTime() === date.getTime())) {
      continue;
    }

    // Only the first time offered is the guess; the other half of the day
    // after it is the alternative.
    const notes = [
      reading.assumed.meridiem && !options.length
        ? `${date.getHours() < 12 ? 'AM' : 'PM'} assumed`
        : undefined,
      reading.assumed.year ? 'year assumed' : undefined,
      reading.assumed.time ? 'default time' : undefined,
    ].filter((note) => note !== undefined);
    options.push({
      id: `phrase-${date.getTime()}`,
      date,
      label,
      note: notes.length ? notes.join(' · ') : undefined,
    });
  }

  if (options.length) return { kind: 'read', options };
  const skipped = guess.start.kind === 'at' && !instantOf(guess.start, now);
  return {
    kind: 'unread',
    reason: skipped
      ? 'Daylight saving time skips that time.'
      : 'That time has passed.',
  };
}

function instantOf(moment: NaturalTimeMoment, now: Date): Date | undefined {
  return match(moment)
    .with({ kind: 'at' }, ({ local }) => instantAtWallClock(local))
    .with(
      { kind: 'after' },
      ({ minutes }) => new Date(now.getTime() + minutes * 60_000)
    )
    .with({ kind: 'day' }, ({ date }) =>
      instantAtWallClock(`${date}T${DEFAULT_TIME}:00`)
    )
    .exhaustive();
}

function unreadReason(error: NaturalTimeError): string {
  return match(error)
    .with(
      'unrecognized',
      () => 'Couldn’t read that as a time. Try in 2 hours or next friday at 3.'
    )
    .with('repeating', () => 'Repeating reminders aren’t supported.')
    .with('conflict', () => 'That names two dates or times. Use one.')
    .with('invalidDate', () => 'There’s no such date.')
    .with('invalidTime', () => 'There’s no such time.')
    .with('weekdayMismatch', () => 'That weekday doesn’t fall on that date.')
    .with('durationWithoutTime', () => 'Add a start time to that length.')
    .with('endBeforeStart', () => 'That range ends before it starts.')
    .with('outOfRange', () => 'That date is too far away.')
    .exhaustive();
}
