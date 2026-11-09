import { loadNaturalTimeForTest } from '@core/natural-time/tests/load-wasm';
import type { NaturalTimeWasmModule } from '@core/natural-time/wasm-module';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readReminderPhrase } from './reminder-phrase';

let reader: NaturalTimeWasmModule;

beforeAll(async () => {
  reader = await loadNaturalTimeForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** What each offered time reads as in the zone under test. */
function offered(phrase: string, now: Date) {
  const reading = readReminderPhrase(reader, phrase, now);
  if (reading.kind === 'unread') return reading.reason;
  return reading.options.map(({ date, label, note }) => ({
    label,
    at: date.toISOString(),
    note,
  }));
}

describe('readReminderPhrase in New York', () => {
  let friday: Date;

  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
    // Friday, November 6, 2026, 10am EST.
    friday = new Date(2026, 10, 6, 10, 0);
  });

  it('offers a guessed pm first and the am reading after it', () => {
    expect(offered('next thurs at 3', friday)).toEqual([
      {
        label: 'next thurs at 3',
        at: '2026-11-12T20:00:00.000Z',
        note: 'PM assumed',
      },
      {
        label: 'next thurs at 3',
        at: '2026-11-12T08:00:00.000Z',
        note: undefined,
      },
    ]);
    expect(offered('tomorrow at 9', friday)).toEqual([
      {
        label: 'tomorrow at 9',
        at: '2026-11-07T14:00:00.000Z',
        note: 'AM assumed',
      },
      {
        label: 'tomorrow at 9',
        at: '2026-11-08T02:00:00.000Z',
        note: undefined,
      },
    ]);
  });

  it('offers one time when am or pm is written', () => {
    expect(offered('tomorrow at 3pm', friday)).toEqual([
      {
        label: 'tomorrow at 3pm',
        at: '2026-11-07T20:00:00.000Z',
        note: undefined,
      },
    ]);
  });

  it('notes the default time and an assumed year', () => {
    expect(offered('tomorrow', friday)).toEqual([
      {
        label: 'tomorrow',
        at: '2026-11-07T14:00:00.000Z',
        note: 'default time',
      },
    ]);
    expect(offered('jan 5', friday)).toEqual([
      {
        label: 'jan 5',
        at: '2027-01-05T14:00:00.000Z',
        note: 'year assumed · default time',
      },
    ]);
  });

  it('counts elapsed time from now', () => {
    expect(offered('in 2 hours', friday)).toEqual([
      { label: 'in 2 hours', at: '2026-11-06T17:00:00.000Z', note: undefined },
    ]);
  });

  it('drops a passed guess and keeps the other half of the day', () => {
    expect(offered('today at 9', friday)).toEqual([
      {
        label: 'today at 9',
        at: '2026-11-07T02:00:00.000Z',
        note: 'PM assumed',
      },
    ]);
    expect(offered('yesterday at 5pm', friday)).toBe('That time has passed.');
  });

  it('never offers a time daylight saving skips', () => {
    expect(offered('mar 14 2027 at 2:30am', friday)).toBe(
      'Daylight saving time skips that time.'
    );
  });

  it('takes the earlier of a repeated fall-back hour', () => {
    expect(offered('nov 7 2027 at 1:30am', friday)).toEqual([
      {
        label: 'nov 7 2027 at 1:30am',
        at: '2027-11-07T05:30:00.000Z',
        note: undefined,
      },
    ]);
  });

  it('explains phrases it cannot read', () => {
    expect(offered('every friday', friday)).toBe(
      'Repeating reminders aren’t supported.'
    );
    expect(offered('feb 30', friday)).toBe('There’s no such date.');
    expect(offered('soonish', friday)).toBe(
      'Couldn’t read that as a time. Try in 2 hours or next friday at 3.'
    );
  });
});

it('reads wall times in the browser’s own time zone', () => {
  vi.stubEnv('TZ', 'Pacific/Auckland');
  // Saturday, November 7, 2026, 4am NZDT: still Friday in New York.
  const now = new Date(2026, 10, 7, 4, 0);
  expect(offered('tomorrow at 3pm', now)).toEqual([
    {
      label: 'tomorrow at 3pm',
      at: '2026-11-08T02:00:00.000Z',
      note: undefined,
    },
  ]);
});
