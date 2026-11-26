import { describe, expect, it } from 'vitest';
import { MAX_ENTRY_MINUTES, parseLength } from './parse-length';

describe('parseLength', () => {
  it.each([
    ['1h 30m', 90],
    ['1h30m', 90],
    ['1h30', 90],
    ['1 h 30 min', 90],
    ['1 hour 30 minutes', 90],
    ['2 hrs 5 mins', 125],
    ['1H 30M', 90],
    ['1.5h', 90],
    ['1,5h', 90],
    ['.5h', 30],
    ['90m', 90],
    ['45 min', 45],
    ['1:30', 90],
    ['0:05', 5],
    ['1.5', 90],
    ['2', 120],
    ['  2  ', 120],
    ['0.01', 1],
    ['10s', undefined],
  ])('reads %j as %s minutes', (input, minutes) => {
    const parsed = parseLength(input);
    if (minutes === undefined) {
      expect(parsed).toEqual({ kind: 'invalid' });
      return;
    }
    expect(parsed).toEqual({ kind: 'length', minutes });
  });

  it.each([
    '',
    '0',
    '0h',
    '0:00',
    'abc',
    '1:75',
    '1:5',
    '-1',
    '-1h',
    '1.5h 30m',
    'h',
    '1h 30x',
  ])('offers nothing for %j', (input) => {
    expect(parseLength(input)).toEqual({ kind: 'invalid' });
  });

  it('says a length over a day is too long rather than unreadable', () => {
    expect(parseLength('24h')).toEqual({
      kind: 'length',
      minutes: MAX_ENTRY_MINUTES,
    });
    expect(parseLength('25h')).toEqual({ kind: 'too-long', minutes: 1500 });
    expect(parseLength('24:01')).toEqual({ kind: 'too-long', minutes: 1441 });
  });
});
