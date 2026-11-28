import { describe, expect, test } from 'bun:test';
import {
  type Draft,
  defaultDraft,
  draftName,
  markFixtureHireSignIn,
  nameLimit,
  parseDraft,
  presetName,
  readPendingHireDraft,
  readRestoredHireDraft,
  savePendingHireDraft,
  saveRestoredHireDraft,
  storeHireDraft,
  takeHireDraft,
  withPreset,
} from './draft';
import {
  billingIntent,
  buildSignInUrl,
  fleetIntent,
  hireIntent,
  macroLoginPath,
  parseReturnIntent,
  passwordsIntent,
  returnPath,
} from './return-intent';

describe('return intents', () => {
  test('round-trips only the local Creator Hire and Fleet destinations', () => {
    for (const intent of [
      hireIntent,
      fleetIntent,
      passwordsIntent,
      billingIntent,
    ]) {
      const link = new URL(buildSignInUrl(intent), 'http://localhost');
      expect(link.pathname).toBe('/sign-in');
      expect(parseReturnIntent(link.search)).toEqual(intent);
      expect(link.searchParams.get('return')).toBe(returnPath(intent));
    }
  });

  test.each([
    'https://example.com/fleet',
    '//example.com/fleet',
    '/\\example.com/fleet',
    '/creator/../fleet',
    '/%2e%2e/fleet',
    '/fleet#private',
    '/fleet?team=another-team',
    '/passwords?actor=owner',
    '/billing?team=another-team',
  ])('rejects %s as a return destination', (target) => {
    expect(
      parseReturnIntent(new URLSearchParams({ return: target }).toString())
    ).toBeUndefined();
  });

  test('uses only fixed Web login return tokens and a valid Creator Hire handoff', () => {
    const handoff = '0bed4e1a-fc68-4d19-a946-e1be33fafac6';
    expect(macroLoginPath(hireIntent, handoff)).toBe(
      `/app/login?return=bots&handoff=${handoff}`
    );
    expect(macroLoginPath(hireIntent, 'https://example.invalid')).toBe(
      '/app/login?return=bots'
    );
    expect(macroLoginPath(fleetIntent, handoff)).toBe('/app/login?return=bots-fleet');
    expect(macroLoginPath(passwordsIntent)).toBe('/app/login?return=bots-passwords');
    expect(macroLoginPath(billingIntent)).toBe('/app/login?return=bots-billing');
  });

  test('rejects duplicate parameters and extras', () => {
    expect(parseReturnIntent('return=%2Ffleet&return=%2F')).toBeUndefined();
    expect(parseReturnIntent('return=%2Ffleet&extra=1')).toBeUndefined();
  });
});

test('a Hire draft stays in its own tab, expires, and can only be consumed once', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const defaultProfile = defaultDraft();
  const draft = {
    ...defaultProfile,
    name: 'Example Bot',
    nameEdited: true,
    look: { ...defaultProfile.look, faceWidth: -0.25 },
  };
  const handoff = storeHireDraft(storage, draft, 10);
  const otherTab = { ...storage, getItem: () => null };

  expect(takeHireDraft(otherTab, handoff, 11)).toBeUndefined();
  expect(takeHireDraft(storage, crypto.randomUUID(), 11)).toBeUndefined();
  expect(markFixtureHireSignIn(otherTab, handoff, 11)).toBe(false);
  expect(markFixtureHireSignIn(storage, handoff, 11)).toBe(true);
  const failedTransition = {
    ...storage,
    setItem() {
      throw new Error('storage write failed');
    },
  };
  expect(() => takeHireDraft(failedTransition, handoff, 12)).toThrow(
    'storage write failed'
  );
  expect(readRestoredHireDraft(storage, 12)).toBeUndefined();

  const result = takeHireDraft(storage, handoff, 12);
  expect(result).toEqual({
    handoff: null,
    draft,
    sampleSignedIn: true,
    expiresAt: 600_010,
  });
  if (!result) throw new Error('Expected to restore the draft');
  expect(readRestoredHireDraft(storage, 12)).toEqual(result);
  const updated = { ...result, draft: { ...result.draft, name: 'Updated' } };
  saveRestoredHireDraft(storage, updated);
  expect(readRestoredHireDraft(storage, 13)).toEqual(updated);
  expect(readRestoredHireDraft(storage, 600_010)).toBeUndefined();
  expect(takeHireDraft(storage, handoff, 13)).toBeUndefined();

  const expired = storeHireDraft(storage, draft, 20);
  expect(takeHireDraft(storage, expired, 600_020)).toBeUndefined();
  expect(takeHireDraft(storage, expired, 21)).toBeUndefined();
});

test('browser Back from sign-in gets the waiting draft without consuming its handoff', () => {
  const values = new Map<string, string>();
  const tab = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  const draft = { ...defaultDraft(), size: 'xl' as const, name: 'Nova' };
  const handoff = storeHireDraft(tab, draft, 1_000);

  const waiting = readPendingHireDraft(tab, 2_000);
  expect(waiting?.draft).toEqual(draft);
  // Nothing was restored or consumed: sign-in can still complete with the same handoff.
  expect(readRestoredHireDraft(tab, 2_000)).toBeUndefined();

  // An edit made after going back travels with the same handoff.
  const edited = { ...draft, intelligence: 'frontier' as const };
  if (waiting) savePendingHireDraft(tab, waiting, edited);
  expect(takeHireDraft(tab, handoff, 3_000)?.draft).toEqual(edited);

  // Once consumed it is a restored draft, not a waiting one.
  expect(readPendingHireDraft(tab, 3_000)).toBeUndefined();
  if (waiting) savePendingHireDraft(tab, waiting, draft);
  expect(readRestoredHireDraft(tab, 3_000)?.draft).toEqual(edited);
});

test('a waiting draft expires with its handoff', () => {
  const values = new Map<string, string>();
  const tab = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  storeHireDraft(tab, defaultDraft(), 1_000);
  expect(readPendingHireDraft(tab, 1_000 + 10 * 60 * 1000)).toBeUndefined();
  expect(values.size).toBe(0);
});

function tabStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

/** A draft as the two-field version stored it. */
function legacyDraft(
  first: string,
  last: string,
  firstEdited: boolean,
  lastEdited: boolean
) {
  const { name: _name, nameEdited: _edited, ...rest } = defaultDraft();
  return { ...rest, first, last, firstEdited, lastEdited };
}

describe('one full name', () => {
  test.each([
    ['Ada'],
    ['Ada Lovelace'],
    ['Mary  Jane   van der Berg'],
    ['Zoë Brontë-O’Neil'],
    ['李 雷'],
    ['X Æ A-12'],
  ])('keeps %p exactly, without splitting or re-joining', (name) => {
    const draft: Draft = { ...defaultDraft(), name, nameEdited: true };
    expect(draftName(draft)).toBe(name);
    expect(parseDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  test('the handed-off name drops only leading and trailing whitespace', () => {
    const draft: Draft = {
      ...defaultDraft(),
      name: '  Ada   Lovelace \t',
      nameEdited: true,
    };
    expect(draftName(draft)).toBe('Ada   Lovelace');
    // The stored field keeps what was typed, so the caret never jumps while typing.
    expect(parseDraft(JSON.parse(JSON.stringify(draft)))?.name).toBe(
      '  Ada   Lovelace \t'
    );
  });

  test('an empty or blank field shows the preset name and is not an edit', () => {
    for (const name of ['', '   ']) {
      const draft: Draft = {
        ...defaultDraft(),
        preset: 'ledger',
        name,
        nameEdited: false,
      };
      expect(draftName(draft)).toBe(presetName('ledger'));
    }
    expect(defaultDraft().name).toBe('Atlas Vance');
    expect(defaultDraft().nameEdited).toBe(false);
  });

  test('accepts a name up to the service limit and rejects a longer one', () => {
    expect(nameLimit).toBe(64);
    const draft = { ...defaultDraft(), nameEdited: true };
    expect(
      parseDraft({ ...draft, name: 'n'.repeat(nameLimit) })?.name
    ).toHaveLength(nameLimit);
    expect(
      parseDraft({ ...draft, name: 'n'.repeat(nameLimit + 1) })
    ).toBeUndefined();
  });

  test.each([
    // [first, last, firstEdited, lastEdited, name, nameEdited]
    ['Atlas', 'Vance', false, false, 'Atlas Vance', false],
    ['Nova', 'Vance', true, false, 'Nova Vance', true],
    ['Atlas', 'Quill', false, true, 'Atlas Quill', true],
    ['Nova', 'Quill', true, true, 'Nova Quill', true],
    ['Cher', '', true, false, 'Cher', true],
    ['', 'Prince', false, true, 'Prince', true],
    ['  Mary Jane ', ' van  Berg ', true, true, 'Mary Jane van  Berg', true],
    ['', '', false, false, '', false],
    ['   ', '', false, false, '', false],
  ] as const)(
    'migrates the legacy parts %p + %p (edited %p/%p) to %p, edited %p',
    (first, last, firstEdited, lastEdited, name, nameEdited) => {
      const legacy = legacyDraft(first, last, firstEdited, lastEdited);
      const migrated = parseDraft(legacy);
      expect(migrated).toEqual({ ...defaultDraft(), name, nameEdited });
      // Nothing of the old shape is carried along.
      expect(Object.keys(migrated ?? {}).sort()).toEqual(
        Object.keys(defaultDraft()).sort()
      );
      // The migrated draft shows the name the two-field version showed.
      const shown =
        [first.trim(), last.trim()].filter(Boolean).join(' ') || 'Atlas Vance';
      if (migrated) expect(draftName(migrated)).toBe(shown);
    }
  );

  test('rejects legacy parts that are malformed or over their old limit', () => {
    expect(
      parseDraft(legacyDraft('n'.repeat(25), 'Vance', true, false))
    ).toBeUndefined();
    const { firstEdited: _dropped, ...partial } = legacyDraft(
      'Nova',
      'Vance',
      true,
      false
    );
    expect(parseDraft(partial)).toBeUndefined();
    expect(parseDraft({ ...defaultDraft(), name: 7 })).toBeUndefined();
    expect(parseDraft({ ...defaultDraft(), size: 'huge' })).toBeUndefined();
  });

  test('a legacy draft waiting on sign-in survives Back, an edit, the auth return and a reload', () => {
    const tab = tabStorage();
    const legacy = legacyDraft('Nova', 'Vance', true, false);
    const handoff = '0193a1b2-0000-7000-8000-0000000000aa';
    tab.setItem(
      'macro.bots.hire',
      JSON.stringify({
        handoff,
        draft: legacy,
        expiresAt: 600_000,
        sampleSignedIn: false,
      })
    );
    const expected: Draft = {
      ...defaultDraft(),
      name: 'Nova Vance',
      nameEdited: true,
    };

    // Browser Back from sign-in: the waiting draft, migrated, with its handoff untouched.
    const waiting = readPendingHireDraft(tab, 1);
    expect(waiting?.draft).toEqual(expected);
    expect(waiting?.handoff).toBe(handoff);

    // An edit made after Back is stored in the new shape under the same handoff.
    const edited: Draft = { ...expected, name: 'Nova de la Vance' };
    if (waiting) savePendingHireDraft(tab, waiting, edited);
    const stored = JSON.parse(tab.values.get('macro.bots.hire') ?? 'null');
    expect(stored.draft).toEqual(edited);
    expect(stored.handoff).toBe(handoff);

    // The auth return consumes the handoff and a later reload reads the same name.
    expect(takeHireDraft(tab, handoff, 2)?.draft).toEqual(edited);
    expect(readRestoredHireDraft(tab, 3)?.draft).toEqual(edited);
  });

  test('a legacy draft is migrated by the auth return and by the fixture sign-in', () => {
    const tab = tabStorage();
    const handoff = '0193a1b2-0000-7000-8000-0000000000ab';
    tab.setItem(
      'macro.bots.hire',
      JSON.stringify({
        handoff,
        draft: legacyDraft('Cher', '', true, false),
        expiresAt: 600_000,
        sampleSignedIn: false,
      })
    );
    expect(markFixtureHireSignIn(tab, handoff, 1)).toBe(true);
    const restored = takeHireDraft(tab, handoff, 2);
    expect(restored?.sampleSignedIn).toBe(true);
    expect(restored?.draft.name).toBe('Cher');
    expect(restored?.draft.nameEdited).toBe(true);
    // What is now in storage is the new shape only.
    const stored = JSON.parse(tab.values.get('macro.bots.hire') ?? 'null');
    expect('first' in stored.draft).toBe(false);
    expect(readRestoredHireDraft(tab, 3)?.draft).toEqual(restored?.draft);
  });

  test('a single-word and a multi-word name round-trip through store, Back, return and reload', () => {
    for (const name of ['Cher', 'Mary  Jane van der Berg', ' padded ']) {
      const tab = tabStorage();
      const draft: Draft = { ...defaultDraft(), name, nameEdited: true };
      const handoff = storeHireDraft(tab, draft, 1);
      expect(readPendingHireDraft(tab, 2)?.draft.name).toBe(name);
      expect(takeHireDraft(tab, handoff, 3)?.draft).toEqual(draft);
      expect(readRestoredHireDraft(tab, 4)?.draft).toEqual(draft);
    }
  });

  test('a preset names the draft only while the name is untouched or cleared', () => {
    const untouched = withPreset(defaultDraft(), 'ledger');
    expect(untouched.name).toBe('Ledger Kade');
    expect(untouched.nameEdited).toBe(false);
    expect(untouched.preset).toBe('ledger');

    const typed = withPreset(
      { ...defaultDraft(), name: 'Cher', nameEdited: true },
      'scout'
    );
    expect(typed.name).toBe('Cher');
    expect(typed.nameEdited).toBe(true);
    expect(typed.preset).toBe('scout');

    // Clearing the field is not an edit, so the next preset names the draft again.
    const cleared = withPreset(
      { ...typed, name: '  ', nameEdited: false },
      'ledger'
    );
    expect(cleared.name).toBe('Ledger Kade');

    // A migrated legacy draft with one edited part keeps its whole name.
    const migrated = parseDraft(legacyDraft('Nova', 'Vance', true, false));
    if (!migrated) throw new Error('Expected a migrated draft');
    expect(withPreset(migrated, 'ledger').name).toBe('Nova Vance');
  });
});
