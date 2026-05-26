import { describe, expect, it } from 'vitest';
import {
  TEAM_SLUG_ALLOWED_INPUT_REGEX,
  TEAM_SLUG_MAX_LENGTH,
  TEAM_SLUG_NORMALIZED_REGEX,
  getTeamSlugError,
  normalizeTeamSlugInput,
} from './teamSlug.ts';

describe('team slug validation', function () {
  it('uses an explicit allowed-input regex for backend-accepted characters', function () {
    expect(TEAM_SLUG_ALLOWED_INPUT_REGEX.test('abc XYZ_- \t\n\f\r')).toBe(
      true
    );
    expect(TEAM_SLUG_ALLOWED_INPUT_REGEX.test('abc123')).toBe(false);
    expect(TEAM_SLUG_ALLOWED_INPUT_REGEX.test('bad.slug')).toBe(false);
    expect(TEAM_SLUG_ALLOWED_INPUT_REGEX.test('café')).toBe(false);
    expect(TEAM_SLUG_ALLOWED_INPUT_REGEX.test('bad!slug')).toBe(false);
  });

  it('uses the normalized backend storage format regex', function () {
    expect(TEAM_SLUG_NORMALIZED_REGEX.test('MY_TEAM_SLUG')).toBe(true);
    expect(TEAM_SLUG_NORMALIZED_REGEX.test('MY__TEAM')).toBe(false);
    expect(TEAM_SLUG_NORMALIZED_REGEX.test('_MY_TEAM')).toBe(false);
    expect(TEAM_SLUG_NORMALIZED_REGEX.test('MY_TEAM_')).toBe(false);
    expect(TEAM_SLUG_NORMALIZED_REGEX.test('my_team')).toBe(false);
  });

  it('normalizes valid input to uppercase underscore-separated words', function () {
    expect(normalizeTeamSlugInput('my-team  slug')).toBe('MY_TEAM_SLUG');
    expect(getTeamSlugError('my-team  slug')).toBeUndefined();
  });

  it('collapses leading, trailing, and repeated separators like the backend', function () {
    expect(normalizeTeamSlugInput('  --my__team\t\nslug__  ')).toBe(
      'MY_TEAM_SLUG'
    );
    expect(getTeamSlugError('  --my__team\t\nslug__  ')).toBeUndefined();
  });

  it('rejects empty and separator-only input', function () {
    expect(getTeamSlugError('')).toBe('team slug cannot be empty');
    expect(getTeamSlugError('  -__\t\n\f\r')).toBe(
      'team slug cannot be empty'
    );
  });

  it('rejects digits', function () {
    expect(getTeamSlugError('TEAM1')).toContain('may only contain');
  });

  it('rejects periods', function () {
    expect(getTeamSlugError('bad.slug')).toContain('may only contain');
  });

  it('rejects non-ASCII letters', function () {
    expect(getTeamSlugError('café')).toContain('may only contain');
  });

  it('rejects punctuation', function () {
    expect(getTeamSlugError('bad!slug')).toContain('may only contain');
  });

  it('enforces the max length after normalization', function () {
    const rawLongSlug = 'AAAAA-----BBBBB-----CCCCC';
    const normalizedRawLongSlug = normalizeTeamSlugInput(rawLongSlug);

    expect(rawLongSlug.length).toBeGreaterThan(TEAM_SLUG_MAX_LENGTH);
    expect(normalizedRawLongSlug).toBe('AAAAA_BBBBB_CCCCC');
    expect(normalizedRawLongSlug.length).toBeLessThanOrEqual(
      TEAM_SLUG_MAX_LENGTH
    );
    expect(getTeamSlugError(rawLongSlug)).toBeUndefined();

    expect(getTeamSlugError('AAAAA_BBBBB_CCCCC_DDD')).toBe(
      `team slug cannot be longer than ${TEAM_SLUG_MAX_LENGTH} characters`
    );
  });
});
