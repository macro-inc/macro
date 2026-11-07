import { describe, expect, it } from 'vitest';
import {
  filterItems,
  generatePassword,
  type PasswordDraft,
  type PasswordItem,
  validateDraft,
} from '../core/types';

const ITEMS: PasswordItem[] = [
  {
    id: 'one',
    teamId: 'team',
    name: 'Docs',
    kind: 'login',
    url: 'https://docs.example',
    folderId: 'work',
    favorite: true,
    shared: false,
    shareCount: 0,
    version: 1,
    hasTotp: false,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '2026-11-01T01:00:00Z',
  },
  {
    id: 'two',
    teamId: 'team',
    name: 'Cloud',
    kind: 'api',
    url: null,
    folderId: null,
    favorite: false,
    shared: true,
    shareCount: 1,
    version: 1,
    hasTotp: false,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: '2026-11-02T01:00:00Z',
  },
];
describe('metadata filters', () => {
  it('combines folder and case-insensitive website search', () => {
    expect(
      filterItems(ITEMS, 'folder:work', 'DOCS.EXAMPLE').map((item) => item.id)
    ).toEqual(['one']);
    expect(filterItems(ITEMS, 'shared', '').map((item) => item.id)).toEqual([
      'two',
    ]);
    expect(filterItems(ITEMS, 'favorites', '').map((item) => item.id)).toEqual([
      'one',
    ]);
  });
  it('sorts recent use without mutating the source', () => {
    expect(filterItems(ITEMS, 'recent', '').map((item) => item.id)).toEqual([
      'two',
      'one',
    ]);
    expect(ITEMS[0].id).toBe('one');
  });
});
it('generates bounded cryptographic passwords without excluded characters', () => {
  for (const length of [12, 24, 128]) {
    const value = generatePassword(length);
    expect(value).toHaveLength(length);
    expect(value).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+\-=?]+$/
    );
  }
  expect(() => generatePassword(0)).toThrow();
  expect(() => generatePassword(129)).toThrow();
});
it('blocks blank names and dangerous URL schemes before saving', () => {
  const draft: PasswordDraft = {
    name: 'Portal',
    kind: 'login',
    url: '',
    folderId: null,
    favorite: false,
    values: { username: '', password: '', notes: '', fields: [] },
  };
  expect(validateDraft(draft)).toBeUndefined();
  expect(validateDraft({ ...draft, name: ' ' })).toBe('name');
  expect(validateDraft({ ...draft, url: 'javascript:alert(1)' })).toBe('url');
  expect(
    validateDraft({ ...draft, url: 'https://example.com' })
  ).toBeUndefined();
});
