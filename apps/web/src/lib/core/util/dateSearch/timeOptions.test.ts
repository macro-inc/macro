import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimeOptions, type TimeOption } from './timeOptions';

function optionsFor(
  query: string,
  presets: (now: Date) => TimeOption[] = () => []
) {
  return createRoot((dispose) => {
    const [search] = createSignal(query);
    const options = createTimeOptions({
      query: search,
      defaultTime: { hours: 9, minutes: 0 },
      presets,
    })();
    dispose();
    return options;
  });
}

describe('createTimeOptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Friday afternoon, inside working hours.
    vi.setSystemTime(new Date(2026, 9, 9, 15, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers tomorrow 5pm first and tomorrow 5am second for "tom 5"', () => {
    const options = optionsFor('tom 5');
    expect(options[0].label).toBe('Tomorrow at 5 PM');
    expect(options[0].date).toEqual(new Date(2026, 9, 10, 17, 0));
    expect(options[1].label).toBe('Tomorrow at 5 AM');
    expect(options[1].date).toEqual(new Date(2026, 9, 10, 5, 0));
  });

  it('reads "tom 9" as tomorrow morning, then tomorrow evening', () => {
    const options = optionsFor('tom 9');
    expect(options.map((option) => option.date)).toEqual([
      new Date(2026, 9, 10, 9, 0),
      new Date(2026, 9, 10, 21, 0),
    ]);
  });

  it('reads a bare "5" as 5pm today, then 5am tomorrow', () => {
    const options = optionsFor('5');
    expect(options[0].label).toBe('5 PM');
    expect(options[0].date).toEqual(new Date(2026, 9, 9, 17, 0));
    expect(options[1].label).toBe('5 AM');
    expect(options[1].date).toEqual(new Date(2026, 9, 10, 5, 0));
  });

  it('moves a bare hour that has passed today to tomorrow', () => {
    vi.setSystemTime(new Date(2026, 9, 9, 18, 0));
    expect(optionsFor('5').map((option) => option.date)).toEqual([
      new Date(2026, 9, 10, 17, 0),
      new Date(2026, 9, 10, 5, 0),
    ]);
  });

  it('keeps tmrw shorthand with explicit and short meridiems', () => {
    expect(optionsFor('tmrw')[0].date).toEqual(new Date(2026, 9, 10, 9, 0));
    expect(optionsFor('tmrw 8')[0].date).toEqual(new Date(2026, 9, 10, 8, 0));
    const evening = optionsFor('tmrw 8p');
    expect(evening[0].label).toBe('Tomorrow at 8 PM');
    expect(evening[0].date).toEqual(new Date(2026, 9, 10, 20, 0));
    expect(evening).toHaveLength(1);
  });

  it.each([
    ['mon', new Date(2026, 9, 12, 9, 0)],
    ['tue', new Date(2026, 9, 13, 9, 0)],
    ['wed', new Date(2026, 9, 14, 9, 0)],
    ['thu', new Date(2026, 9, 15, 9, 0)],
    ['fri', new Date(2026, 9, 16, 9, 0)],
    ['sat', new Date(2026, 9, 10, 9, 0)],
    ['sun', new Date(2026, 9, 11, 9, 0)],
  ])('resolves %s to the next such weekday', (query, date) => {
    expect(optionsFor(query)[0].date).toEqual(date);
  });

  it('resolves "fri 5" to next Friday at 5pm before 5am', () => {
    expect(
      optionsFor('fri 5')
        .slice(0, 2)
        .map((option) => option.date)
    ).toEqual([new Date(2026, 9, 16, 17, 0), new Date(2026, 9, 16, 5, 0)]);
  });

  it('resolves eod to 5pm today', () => {
    const options = optionsFor('eod');
    expect(options[0].label).toBe('End of day');
    expect(options[0].date).toEqual(new Date(2026, 9, 9, 17, 0));
  });

  it('resolves next week to Monday', () => {
    const options = optionsFor('next week');
    expect(options[0].label).toBe('Next week');
    expect(options[0].date).toEqual(new Date(2026, 9, 12, 9, 0));
    expect(optionsFor('nw')[0].date).toEqual(new Date(2026, 9, 12, 9, 0));
  });

  it('resolves in 2h from now', () => {
    expect(optionsFor('in 2h')[0].date).toEqual(new Date(2026, 9, 9, 17, 0));
  });

  it('never offers a time that has passed', () => {
    expect(optionsFor('today 9am')).toEqual([]);
    expect(optionsFor('yesterday')).toEqual([]);
  });

  it('lists each instant once', () => {
    for (const query of ['fri', 'fri 5', 'mon 9', 'tom', 'next week']) {
      const instants = optionsFor(query).map((option) => option.date.getTime());
      expect(new Set(instants).size).toBe(instants.length);
    }
  });

  it('shows the presets until the user types, then the matching ones first', () => {
    const presets = (now: Date) => [
      {
        id: 'tomorrow-morning',
        label: 'Tomorrow morning',
        date: new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1,
          9,
          0
        ),
      },
      {
        id: 'monday-morning',
        label: 'Monday morning',
        date: new Date(2026, 9, 12, 8, 0),
      },
    ];
    expect(optionsFor('', presets).map((option) => option.id)).toEqual([
      'tomorrow-morning',
      'monday-morning',
    ]);
    const typed = optionsFor('tom', presets);
    expect(typed[0].id).toBe('tomorrow-morning');
    // The parsed "Tomorrow" is the same instant as the preset.
    expect(
      typed.filter(
        (option) =>
          option.date.getTime() === new Date(2026, 9, 10, 9, 0).getTime()
      )
    ).toHaveLength(1);
  });

  describe('across a daylight-saving gap', () => {
    const timezone = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = 'America/New_York';
      // Saturday before clocks spring forward at 2am on Sunday, March 8.
      vi.setSystemTime(new Date(2026, 2, 7, 12, 0));
    });
    afterEach(() => {
      process.env.TZ = timezone;
    });

    it('drops a wall time that does not exist that day', () => {
      expect(optionsFor('tom 2:30am')).toEqual([]);
      expect(optionsFor('tom 3:30am')[0].date.getHours()).toBe(3);
    });
  });
});
