import { TOKENS } from '@core/hotkey/tokens';
import { describe, expect, it } from 'vitest';
import { HOTKEY_PROFILES, type ProfileKey } from './profiles';

function tokenValues(tree: object): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : tokenValues(value)
  );
}

const keyName = (key: ProfileKey) =>
  typeof key === 'string' ? key : key.join(' ');

describe.each(HOTKEY_PROFILES)('$id', (profile) => {
  it('aliases only registered hotkey tokens', () => {
    const tokens = new Set(tokenValues(TOKENS));
    const aliased = profile.bindings.flatMap((binding) =>
      'tokens' in binding.target ? binding.target.tokens : []
    );
    expect(aliased.filter((token) => !tokens.has(token))).toEqual([]);
  });

  it('gives every key one meaning in each context', () => {
    for (const context of ['view', 'detail'] as const) {
      const keys = profile.bindings
        .filter((binding) =>
          'tokens' in binding.target
            ? binding.target.contexts.some((c) => c === context)
            : context === 'view'
        )
        .flatMap((binding) => binding.keys.map(keyName));
      expect(keys.length).toBe(new Set(keys).size);
    }
    const sameKeys = new Set(profile.sameKeys.map(keyName));
    expect(
      profile.bindings
        .flatMap((binding) => binding.keys.map(keyName))
        .filter((key) => sameKeys.has(key))
    ).toEqual([]);
  });
});
