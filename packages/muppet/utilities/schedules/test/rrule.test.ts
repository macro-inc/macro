import { describe, expect, test } from 'bun:test';
import { checkRule, nextOccurrence, ruleText } from '../rrule.ts';

const at = (text: string) => Temporal.Instant.from(text);
const epoch = at('1970-01-01T00:00:00Z');

describe('checkRule', () => {
  test('canonicalizes a good rule', () => {
    expect(checkRule('freq=hourly; byminute=1,31')).toBe(
      'FREQ=HOURLY;BYMINUTE=1,31'
    );
  });

  test('refuses what the library would quietly ignore', () => {
    expect(() => checkRule('FREQ=DAILY;BYHOUR=25')).toThrow(
      'BYHOUR: 25 is not 0 to 23'
    );
    expect(() => checkRule('FREQ=DAILY;BYDAY=0MO')).toThrow(
      '0 is not an ordinal'
    );
    expect(() => checkRule('BYHOUR=9')).toThrow('FREQ is required');
    expect(() =>
      checkRule('FREQ=DAILY;COUNT=2;UNTIL=20270101T000000Z')
    ).toThrow('cannot both');
  });

  test('says when a rule looks like cron', () => {
    expect(() => checkRule('0 9 * * 1')).toThrow('looks like cron');
  });
});

describe('nextOccurrence', () => {
  test("finds the next wall-clock time in the rule's zone", () => {
    expect(
      nextOccurrence(
        'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        { start: epoch, tz: 'America/New_York' },
        at('2026-11-09T15:00:00Z')
      )?.toString()
    ).toBe('2026-11-10T14:00:00Z');
  });

  test("skips a time that doesn't exist on spring-forward day", () => {
    expect(
      nextOccurrence(
        'FREQ=DAILY;BYHOUR=2;BYMINUTE=30',
        { start: epoch, tz: 'America/New_York' },
        at('2027-03-13T08:00:00Z')
      )?.toString()
    ).toBe('2027-03-15T06:30:00Z');
  });

  test('ends with COUNT', () => {
    const anchor = { start: at('2026-01-01T00:00:00Z'), tz: 'UTC' };
    expect(
      nextOccurrence('FREQ=DAILY;COUNT=2', anchor, at('2026-01-02T00:00:00Z'))
    ).toBeNull();
  });
});

test('ruleText reads as English', () => {
  expect(
    ruleText('FREQ=HOURLY;BYMINUTE=1,31', { start: epoch, tz: 'UTC' })
  ).toContain('every hour');
});
