import { describe, expect, it, vi } from 'vitest';
import { createGettingStartedState } from './getting-started-state';
import type { GettingStartedStore } from './getting-started-store';

describe('createGettingStartedState', () => {
  it('loads progress eagerly and persists updates for its user', () => {
    const store: GettingStartedStore = {
      load: vi.fn().mockReturnValue({
        completedActionIds: ['set-name'],
        collapsedSectionIds: ['basics'],
      }),
      save: vi.fn(),
    };
    const state = createGettingStartedState('user-1', store);

    expect(state.isPersistedComplete('set-name')).toBe(true);
    expect(state.isCollapsed('basics')).toBe(true);

    state.markCompleted('connect-email');
    expect(store.save).toHaveBeenLastCalledWith('user-1', {
      completedActionIds: ['set-name', 'connect-email'],
      collapsedSectionIds: ['basics'],
    });

    state.toggleSection('basics');
    expect(store.save).toHaveBeenLastCalledWith('user-1', {
      completedActionIds: ['set-name', 'connect-email'],
      collapsedSectionIds: [],
    });
  });
});
