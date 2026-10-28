import { describe, expect, it } from 'vitest';
import { isPageDivider, stepPage } from './pages';

describe('page dividers', () => {
  it('treats separator-only names as dividers', () => {
    expect(isPageDivider('------')).toBe(true);
    expect(isPageDivider(' — — ')).toBe(true);
    expect(isPageDivider('***')).toBe(true);
    expect(isPageDivider('Cover')).toBe(false);
    expect(isPageDivider('- Drafts')).toBe(false);
    expect(isPageDivider('')).toBe(false);
  });

  it('steps over dividers', () => {
    const pages = [{ name: 'Cover' }, { name: '---' }, { name: 'Pages' }];
    expect(stepPage(pages, 0, 1)).toBe(2);
    expect(stepPage(pages, 2, -1)).toBe(0);
    expect(stepPage(pages, 2, 1)).toBeUndefined();
    expect(stepPage(pages, 0, -1)).toBeUndefined();
  });
});
