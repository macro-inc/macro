import { expect, it, vi } from 'vitest';
import { soupQueryKeyText } from './query-key-text';

it('serializes immutable filter keys once while preserving exact text matching', () => {
  const key = [
    'soup',
    'astItems',
    { filter: { id: 'folder', nested: [null, undefined, 'quoted"'] } },
  ];
  const expected = JSON.stringify(key);
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    expect(soupQueryKeyText(key)).toBe(expected);
    for (let i = 0; i < 100; i++) expect(soupQueryKeyText(key)).toBe(expected);
    expect(stringify).toHaveBeenCalledTimes(1);
    const replacement = [...key, { filter: { id: 'another-folder' } }];
    expect(soupQueryKeyText(replacement)).toContain('another-folder');
    expect(stringify).toHaveBeenCalledTimes(2);
  } finally {
    stringify.mockRestore();
  }
});
