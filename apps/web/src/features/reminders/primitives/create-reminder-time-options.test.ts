import type { NaturalTimeState } from '@core/natural-time/create-natural-time';
import { loadNaturalTimeForTest } from '@core/natural-time/tests/load-wasm';
import { createRoot, createSignal } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createReminderTimeOptions } from './create-reminder-time-options';

let ready: NaturalTimeState;

beforeAll(async () => {
  ready = { status: 'ready', reader: await loadNaturalTimeForTest() };
});

function choicesFor(text: string, state: NaturalTimeState = ready) {
  return createRoot((dispose) => {
    const [query] = createSignal(text);
    const choices = createReminderTimeOptions(query, () => state)();
    dispose();
    return {
      reason: choices.reason,
      times: choices.times.map(({ label, date, note }) => ({
        label,
        at: `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`,
        note,
      })),
    };
  });
}

describe('createReminderTimeOptions', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
    vi.useFakeTimers();
    // Friday afternoon so "tomorrow" and weekday shorthands are unambiguous
    vi.setSystemTime(new Date(2026, 9, 9, 15, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('offers the presets before anything is typed', () => {
    expect(choicesFor('').times.map(({ label }) => label)).toEqual([
      'In 30m',
      'Later today',
      'Tomorrow',
      'Next week',
    ]);
  });

  it('puts the typed time first and drops the preset at the same time', () => {
    expect(choicesFor('tomorrow')).toEqual({
      reason: undefined,
      times: [{ label: 'tomorrow', at: '10/10 9:00', note: 'default time' }],
    });
    expect(choicesFor('next week').times).toEqual([
      { label: 'next week', at: '10/12 9:00', note: 'default time' },
    ]);
  });

  it('offers both halves of the day when am or pm is guessed', () => {
    expect(choicesFor('tmrw 8').times).toEqual([
      { label: 'tmrw 8', at: '10/10 8:00', note: 'AM assumed' },
      { label: 'tmrw 8', at: '10/10 20:00', note: undefined },
    ]);
    expect(choicesFor('tmrw 8p').times).toEqual([
      { label: 'tmrw 8p', at: '10/10 20:00', note: undefined },
    ]);
  });

  it('resolves weekday shorthands to their next occurrence', () => {
    expect(choicesFor('fri').times[0]?.at).toBe('10/16 9:00');
    expect(choicesFor('thu').times[0]?.at).toBe('10/15 9:00');
    expect(choicesFor('mon').times[0]?.at).toBe('10/12 9:00');
  });

  it('explains a phrase it cannot read and keeps matching presets', () => {
    expect(choicesFor('every friday')).toEqual({
      reason: 'Repeating reminders aren’t supported.',
      times: [],
    });
    expect(choicesFor('later').times.map(({ label }) => label)).toEqual([
      'Later today',
    ]);
  });

  it('keeps the presets while the reader loads or after it fails', () => {
    expect(choicesFor('tom', { status: 'loading' })).toEqual({
      reason: undefined,
      times: [{ label: 'Tomorrow', at: '10/10 9:00', note: undefined }],
    });
    expect(choicesFor('next friday at 3', { status: 'failed' })).toEqual({
      reason: 'Typed times aren’t available right now. Choose one below.',
      times: [],
    });
  });
});
