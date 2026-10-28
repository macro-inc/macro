import { describe, expect, it } from 'vitest';
import { MAX_USER_API_KEY_NAME_LEN, normalizeUserApiKeyName } from './name';

describe('normalizeUserApiKeyName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeUserApiKeyName('  CI  ')).toEqual({
      ok: true,
      name: 'CI',
    });
  });

  it('rejects a blank name', () => {
    expect(normalizeUserApiKeyName('   ')).toEqual({
      ok: false,
      error: 'API key name must not be empty',
    });
  });

  it('accepts a name at the character limit', () => {
    const name = 'a'.repeat(MAX_USER_API_KEY_NAME_LEN);
    expect(normalizeUserApiKeyName(name)).toEqual({ ok: true, name });
  });

  it('rejects a name over the character limit', () => {
    const name = 'a'.repeat(MAX_USER_API_KEY_NAME_LEN + 1);
    expect(normalizeUserApiKeyName(name)).toEqual({
      ok: false,
      error: `API key name must be at most ${MAX_USER_API_KEY_NAME_LEN} characters`,
    });
  });

  it('counts Unicode scalar values, not UTF-16 code units', () => {
    const name = '🔑'.repeat(MAX_USER_API_KEY_NAME_LEN);
    expect(normalizeUserApiKeyName(name)).toEqual({ ok: true, name });
    expect(normalizeUserApiKeyName(`${name}x`)).toEqual({
      ok: false,
      error: `API key name must be at most ${MAX_USER_API_KEY_NAME_LEN} characters`,
    });
  });
});
