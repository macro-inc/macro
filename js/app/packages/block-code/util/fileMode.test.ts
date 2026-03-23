import { describe, expect, it } from 'vitest';
import { isHtmlFileType } from './fileMode';

describe('isHtmlFileType', () => {
  it('returns true for supported html file extensions', () => {
    expect(isHtmlFileType('html')).toBe(true);
    expect(isHtmlFileType('HTM')).toBe(true);
    expect(isHtmlFileType('xhtml')).toBe(true);
    expect(isHtmlFileType('shtml')).toBe(true);
  });

  it('returns false for unsupported extensions', () => {
    expect(isHtmlFileType('md')).toBe(false);
    expect(isHtmlFileType('js')).toBe(false);
    expect(isHtmlFileType(undefined)).toBe(false);
    expect(isHtmlFileType(null)).toBe(false);
  });
});
