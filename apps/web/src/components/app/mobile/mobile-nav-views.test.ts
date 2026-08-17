import { describe, expect, it } from 'vitest';
import { isMobileNavViewId } from './mobile-nav-views';

describe('isMobileNavViewId', () => {
  it('accepts pill-row views and rejects everything else', () => {
    expect(isMobileNavViewId('inbox')).toBe(true);
    expect(isMobileNavViewId('channels')).toBe(true);
    expect(isMobileNavViewId('settings')).toBe(true);
    expect(isMobileNavViewId('commands')).toBe(false);
    expect(isMobileNavViewId('folders')).toBe(false);
    expect(isMobileNavViewId('search')).toBe(false);
    expect(isMobileNavViewId('md')).toBe(false);
  });
});
