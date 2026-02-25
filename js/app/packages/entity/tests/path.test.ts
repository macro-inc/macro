import { describe, expect, it } from 'vitest';
import { truncatedPath } from '../src/utils/path';

describe('truncatedPath', () => {
  describe('basic functionality', () => {
    it('returns empty string for empty path', () => {
      expect(truncatedPath([], 100)).toBe('');
    });

    it('returns empty string when maxChars is 0', () => {
      expect(truncatedPath(['root', 'file.txt'], 0)).toBe('');
    });

    it('returns empty string when maxChars is negative', () => {
      expect(truncatedPath(['root', 'file.txt'], -5)).toBe('');
    });

    it('filters out empty and whitespace-only segments', () => {
      expect(truncatedPath(['root', '', '  ', 'file.txt'], 100)).toBe(
        'root / file.txt'
      );
    });

    it('returns full path when it fits within maxChars', () => {
      const path = ['root', 'folder', 'file.txt'];
      const full = 'root / folder / file.txt';
      expect(truncatedPath(path, full.length)).toBe(full);
      expect(truncatedPath(path, full.length + 10)).toBe(full);
    });
  });

  describe('path collapsing', () => {
    it('collapses middle segments when path is too long', () => {
      const path = ['root', 'very', 'long', 'nested', 'path', 'file.txt'];
      // Should collapse to: root / … / file.txt
      expect(truncatedPath(path, 25)).toBe('root / … / file.txt');
    });

    it('handles two-segment path (no middle to collapse)', () => {
      const path = ['root', 'file.txt'];
      expect(truncatedPath(path, 20)).toBe('root / file.txt');
    });

    it('collapses to ellipsis and filename when root does not fit', () => {
      const path = ['very-long-root-name', 'file.txt'];
      // Should show: … / file.txt
      expect(truncatedPath(path, 15)).toBe('… / file.txt');
    });
  });

  describe('filename truncation', () => {
    it('truncates filename when even minimal path is too long', () => {
      const path = ['root', 'very-long-filename-that-needs-truncation.txt'];
      // With maxChars=15, should truncate filename
      const result = truncatedPath(path, 15);
      expect(result).toContain('…');
      expect(result.length).toBeLessThanOrEqual(15);
    });

    it('preserves file extension when truncating filename', () => {
      const path = ['root', 'very-long-filename.txt'];
      // Should try to keep .txt extension
      const result = truncatedPath(path, 18);
      expect(result).toContain('.txt');
      expect(result).toMatch(/… \/ .*\.txt/);
    });

    it('handles filename without extension', () => {
      const path = ['root', 'verylongfilenamewithoutextension'];
      const result = truncatedPath(path, 15);
      expect(result).toContain('…');
      expect(result.length).toBeLessThanOrEqual(15);
    });

    it('handles filename with multiple dots', () => {
      const path = ['root', 'file.name.with.dots.txt'];
      const result = truncatedPath(path, 20);
      // Should preserve the last extension (.txt)
      expect(result).toContain('.txt');
    });

    it('truncates when extension is longer than budget', () => {
      const path = ['root', 'file.verylongextension'];
      const result = truncatedPath(path, 10);
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result).toContain('…');
    });

    it('handles extreme truncation to just ellipsis', () => {
      const path = ['root', 'file.txt'];
      // maxChars=1 should return just one character of ellipsis
      expect(truncatedPath(path, 1)).toBe('…');
    });
  });

  describe('edge cases', () => {
    it('handles single-segment path', () => {
      expect(truncatedPath(['file.txt'], 100)).toBe('file.txt');
      // Single segment still uses the root/file pattern, so it becomes "… / f…"
      expect(truncatedPath(['file.txt'], 5)).toBe('… / f…');
    });

    it('handles path with special characters', () => {
      const path = ['root', 'folder@2024', 'file (1).txt'];
      const result = truncatedPath(path, 100);
      expect(result).toBe('root / folder@2024 / file (1).txt');
    });

    it('handles very long single segment', () => {
      const longName = 'a'.repeat(100);
      const path = [longName];
      const result = truncatedPath(path, 10);
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result).toContain('…');
    });

    it('handles path with unicode characters', () => {
      const path = ['root', 'folder', 'файл.txt'];
      expect(truncatedPath(path, 100)).toContain('файл.txt');
    });
  });

  describe('separator handling', () => {
    it('uses " / " as separator', () => {
      const path = ['root', 'folder', 'file.txt'];
      const result = truncatedPath(path, 100);
      expect(result).toMatch(/root \/ folder \/ file\.txt/);
    });

    it('accounts for separator length in truncation', () => {
      const path = ['a', 'b', 'c'];
      // "a / b / c" = 9 characters
      expect(truncatedPath(path, 9)).toBe('a / b / c');
      // With maxChars=8, "a / … / c" (9 chars) doesn't fit, so it returns "… / c" (5 chars)
      expect(truncatedPath(path, 8)).toBe('… / c');
    });
  });
});
