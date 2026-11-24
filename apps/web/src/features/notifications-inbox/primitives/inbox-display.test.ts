import { describe, expect, it } from 'vitest';
import { createCondensedPreference } from './inbox-display';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
}

describe('createCondensedPreference', () => {
  it('starts with full rows when nothing is saved', () => {
    expect(createCondensedPreference(memoryStorage()).condensed()).toBe(false);
  });

  it('keeps Condensed between visits', () => {
    const storage = memoryStorage();
    createCondensedPreference(storage).setCondensed(true);

    expect(createCondensedPreference(storage).condensed()).toBe(true);
  });
});
