import { expect, test } from 'bun:test';
import {
  clearWorkingDraft,
  defaultDraft,
  matchesPreset,
  readWorkingDraft,
  saveWorkingDraft,
  withPreset,
} from './draft';

function memory() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

test('the working draft survives a reload exactly, name and look', () => {
  const storage = memory();
  const draft = {
    ...defaultDraft(),
    name: 'Ada  de  Lovelace',
    nameEdited: true,
  };
  draft.look = { ...draft.look, hair: 'waves', faceWidth: -0.35 };
  saveWorkingDraft(storage, draft);
  expect(readWorkingDraft(storage)).toEqual(draft);
});

test('anything that is not a valid draft is dropped, not trusted', () => {
  const storage = memory();
  for (const bad of ['{', '{"preset":"nobody"}', '[]', 'null']) {
    storage.setItem('macro-bots:working-draft', bad);
    expect(readWorkingDraft(storage)).toBeUndefined();
    expect(storage.items.size).toBe(0);
  }
});

test('clearing removes it', () => {
  const storage = memory();
  saveWorkingDraft(storage, defaultDraft());
  clearWorkingDraft(storage);
  expect(readWorkingDraft(storage)).toBeUndefined();
});

test('a preset is the selected one only while the look is exactly its own', () => {
  const draft = defaultDraft();
  expect(matchesPreset(draft)).toBe(true);
  expect(
    matchesPreset({ ...draft, look: { ...draft.look, hair: 'buzz' } })
  ).toBe(draft.look.hair === 'buzz');
  const other = withPreset(draft, 'scout');
  expect(matchesPreset(other)).toBe(true);
});
