import { describe, expect, it } from 'vitest';
import { buildSearchTerms } from './search-utils';

describe('buildSearchTerms', () => {
  it('splits simple terms by whitespace', () => {
    expect(buildSearchTerms('hello world')).toEqual(['hello', 'world']);
  });

  it('handles multiple spaces between terms', () => {
    expect(buildSearchTerms('hello   world')).toEqual(['hello', 'world']);
  });

  it('returns single term for single word', () => {
    expect(buildSearchTerms('hello')).toEqual(['hello']);
  });

  it('strips quotes from quoted terms', () => {
    expect(buildSearchTerms('"hello"')).toEqual(['hello']);
  });

  it('correctly handles multi-word quoted terms', () => {
    expect(buildSearchTerms('"hello world" test "foo bar"')).toEqual([
      'hello world',
      'test',
      'foo bar',
    ]);
  });

  it('correctly does not group single quoted terms', () => {
    expect(buildSearchTerms("'hello world' test 'foo bar'")).toEqual([
      "'hello",
      "world'",
      'test',
      "'foo",
      "bar'",
    ]);
  });

  it('strips quotes from quoted terms mixed with unquoted', () => {
    expect(buildSearchTerms('foo "bar" baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns empty array for empty string', () => {
    expect(buildSearchTerms('')).toEqual(['']);
  });

  it('handles leading and trailing whitespace', () => {
    expect(buildSearchTerms('  hello world  ')).toEqual(['hello', 'world']);
  });
});
