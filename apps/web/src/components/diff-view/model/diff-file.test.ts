import { describe, expect, it } from 'vitest';
import { splitPath, statusLetter } from './diff-file';

describe('statusLetter', () => {
  it('maps every kind to its letter', () => {
    expect(statusLetter('added')).toBe('A');
    expect(statusLetter('modified')).toBe('M');
    expect(statusLetter('deleted')).toBe('D');
    expect(statusLetter('renamed')).toBe('R');
  });
});

describe('splitPath', () => {
  it('keeps the trailing slash on the directory', () => {
    expect(splitPath('apps/web/src/a.ts')).toEqual({
      dir: 'apps/web/src/',
      base: 'a.ts',
    });
  });

  it('treats a bare name as having no directory', () => {
    expect(splitPath('README.md')).toEqual({ dir: '', base: 'README.md' });
  });
});
