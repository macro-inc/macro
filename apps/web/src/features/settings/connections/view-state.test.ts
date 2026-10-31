import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createConnectionsViewState } from './view-state';

it('opens a selected provider and returns to its connection overview', () => {
  createRoot((dispose) => {
    const view = createConnectionsViewState({ provider: 'github' });
    expect(view.provider()).toBe('github');
    view.showOverview();
    expect(view.provider()).toBeNull();
    dispose();
  });
});
it('starts with the unified overview and returns after closing a provider', () => {
  createRoot((dispose) => {
    const view = createConnectionsViewState();
    expect(view.provider()).toBeNull();
    view.openProvider('github');
    view.closeProvider();
    expect(view.provider()).toBeNull();
    dispose();
  });
});
