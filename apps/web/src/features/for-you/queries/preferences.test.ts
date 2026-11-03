import { createRoot } from 'solid-js';
import { beforeEach, expect, it } from 'vitest';
import { createFeedPreferences } from './preferences';

beforeEach(() => localStorage.clear());
it('persists preferences and dismissals only for their account', () =>
  createRoot((dispose) => {
    const first = createFeedPreferences('one', 'default');
    first.setPrompt('Focus on business workflows.');
    first.setHiddenIds(['hidden']);
    const restored = createFeedPreferences('one', 'default');
    const other = createFeedPreferences('two', 'default');
    expect(restored.prompt()).toBe('Focus on business workflows.');
    expect(restored.hiddenIds()).toEqual(['hidden']);
    expect(other.prompt()).toBe('default');
    expect(other.hiddenIds()).toEqual([]);
    dispose();
  }));
