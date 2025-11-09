import { describe, expect, it } from 'vitest';
import { getHeaderValue } from './getHeaderValue';

describe('getHeaderValue', () => {
  it('returns undefined for null or undefined headers', () => {
    expect(getHeaderValue(undefined as unknown, 'x-test')).toBeUndefined();
    expect(getHeaderValue(null as unknown, 'x-test')).toBeUndefined();
  });

  it('parses string header lines of form "key: value"', () => {
    expect(getHeaderValue('Content-Type: text/html', 'content-type')).toBe(
      'text/html'
    );
    expect(getHeaderValue('X-Foo: Bar', 'x-bar')).toBeUndefined();
    expect(
      getHeaderValue('InvalidHeaderWithoutColon', 'invalid')
    ).toBeUndefined();
  });

  it('finds values in plain objects (case-insensitive key)', () => {
    expect(
      getHeaderValue({ 'Content-Type': 'text/plain' }, 'content-type')
    ).toBe('text/plain');
    expect(getHeaderValue({ 'X-Foo': { value: 'Bar' } }, 'x-foo')).toBe('Bar');
    expect(getHeaderValue({ 'Set-Cookie': ['a=1', 'b=2'] }, 'set-cookie')).toBe(
      'a=1'
    );
  });

  it('finds values in Map objects', () => {
    const map = new Map<string, unknown>([['X-Id', '123']]);
    expect(getHeaderValue(map, 'x-id')).toBe('123');
  });

  it('supports the { name, value } shape', () => {
    expect(getHeaderValue({ name: 'X-Id', value: 'abc' }, 'x-id')).toBe('abc');
    expect(
      getHeaderValue({ name: 'X-Id', value: ['abc', 'def'] }, 'x-id')
    ).toBe('abc');
    expect(
      getHeaderValue({ name: 'X-Id', value: 'abc' }, 'other')
    ).toBeUndefined();
  });

  it('searches arrays of headers and returns the first match', () => {
    const headers = [
      { 'X-Other': 'zzz' },
      'X-Test: first',
      { name: 'X-Test', value: 'second' },
    ];
    expect(getHeaderValue(headers, 'x-test')).toBe('first');
  });
});
