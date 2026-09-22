import { describe, expect, it } from 'vitest';
import { createConnectionsViewState } from './view-state';

describe('Connections navigation', () => {
  it('returns to Discover after opening a featured provider', () => {
    const view = createConnectionsViewState();
    view.showDiscover();
    view.openProvider('linear');
    expect(view.provider()).toBe('linear');
    view.closeProvider();
    expect(view.provider()).toBeNull();
    expect(view.mode()).toBe('discover');
  });

  it('returns to Connected after opening a connected provider', () => {
    const view = createConnectionsViewState();
    view.openProvider('github');
    view.closeProvider();
    expect(view.mode()).toBe('connected');
    expect(view.provider()).toBeNull();
  });

  it('isolates navigation between mounted workspaces and fresh visits', () => {
    const first = createConnectionsViewState();
    first.showDiscover();
    first.openProvider('notion');
    const second = createConnectionsViewState();
    expect(second.mode()).toBe('connected');
    expect(second.provider()).toBeNull();
    first.showOverview();
    expect(first.provider()).toBeNull();
    expect(first.mode()).toBe('connected');
  });
});
