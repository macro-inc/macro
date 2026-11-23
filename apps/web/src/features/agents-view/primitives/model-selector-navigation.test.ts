import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createModelSelectorNavigation } from './model-selector-navigation';

describe('card selector navigation', () => {
  it('returns directly to the card from every selection page on Escape', () => {
    createRoot((dispose) => {
      const nav = createModelSelectorNavigation();
      nav.changeOpen(true);
      for (const page of ['list', 'all', 'agents'] as const) {
        nav.setPage(page);
        nav.setQuery('query');
        nav.escape();
        expect(nav.page()).toBe('card');
        expect(nav.query()).toBe('');
        expect(nav.open()).toBe(true);
      }
      nav.escape();
      expect(nav.open()).toBe(false);
      dispose();
    });
  });
  it('resets nested pages and search only when the selector is dismissed', () => {
    createRoot((dispose) => {
      const changed = vi.fn();
      const nav = createModelSelectorNavigation(changed);
      nav.changeOpen(true);
      nav.changeOpen(true);
      nav.setPage('list');
      nav.setQuery('abc');
      nav.setPage('all');
      expect(nav.query()).toBe('');
      nav.back();
      expect(nav.page()).toBe('list');
      nav.back();
      expect(nav.page()).toBe('card');
      expect(nav.open()).toBe(true);
      nav.setPage('agents');
      nav.setQuery('search');
      nav.changeOpen(false);
      expect(nav.page()).toBe('card');
      expect(nav.query()).toBe('');
      expect(changed.mock.calls).toEqual([[true], [false]]);
      dispose();
    });
  });
});
