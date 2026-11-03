import { createRoot } from 'solid-js';
import { beforeEach, expect, it } from 'vitest';
import { createFeedPreferences } from './preferences';

beforeEach(() => localStorage.clear());
it('keeps defaults current when only dismissals were saved', () =>
  createRoot((dispose) => {
    const first = createFeedPreferences('one', 'Original default');
    first.setHiddenIds(['hidden']);
    const restored = createFeedPreferences('one', 'Updated default');
    expect(restored.prompt()).toBe('Updated default');
    expect(restored.hiddenIds()).toEqual(['hidden']);
    dispose();
  }));

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

it('shares changes between mounted Home and feed adapters without overwriting prompts', () =>
  createRoot((dispose) => {
    const home = createFeedPreferences('one', 'default');
    const full = createFeedPreferences('one', 'default');
    const other = createFeedPreferences('two', 'default');
    full.setPrompt('Keep track of open decisions.');
    home.setHiddenIds(['hidden']);
    expect(full.hiddenIds()).toEqual(['hidden']);
    expect(home.prompt()).toBe('Keep track of open decisions.');
    expect(other.hiddenIds()).toEqual([]);
    const restored = createFeedPreferences('one', 'default');
    expect(restored.prompt()).toBe('Keep track of open decisions.');
    dispose();
  }));
