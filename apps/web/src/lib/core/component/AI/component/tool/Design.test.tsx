import { describe, expect, it, vi } from 'vitest';
import { describedPageCount, readDesignHandler } from './Design';

// The document chip pulls in the app's live clients; these tests need none.
vi.mock('@core/component/ItemPreview', () => ({ ItemPreview: () => null }));

describe('design tools', () => {
  it('reads the page count from a description', () => {
    expect(
      describedPageCount('Design: "Checkout (v2)" (3 pages)\n\nPage 1 "Cart"')
    ).toBe(3);
    expect(describedPageCount('Design: untitled (1 page)')).toBe(1);
    expect(describedPageCount('Page 1 "Cart" (id 0:1)')).toBeUndefined();
    expect(readDesignHandler.handleResponse).toBeUndefined();
  });
});
