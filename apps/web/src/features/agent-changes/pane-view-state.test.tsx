import {
  createMemorySplitRouterLocation,
  defineRoute,
  SplitRouter,
  type SplitRouterLayout,
  type SplitRouterLayoutEntry,
  type SplitRouterSettledChange,
  type SplitRoutes,
} from '@app/lib/split-router';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { changesSearch } from './changes-search';
import type { PaneViewState } from './context/agent-changes-context';
import { createPaneViewState } from './pane-view-state';

function createLayout(): SplitRouterLayout<string> {
  let entry: SplitRouterLayoutEntry<string> | undefined;
  const listeners = new Set<(change: SplitRouterSettledChange) => void>();
  const notify = () => {
    for (const listener of listeners) listener({ history: 'push' });
  };
  return {
    snapshot: () => ({ entries: entry ? [entry] : [] }),
    updateCurrentLocation(_splitId, update) {
      if (!entry) return;
      entry = { splitId: entry.splitId, location: update(entry) };
      notify();
    },
    open: () => ({ status: 'unavailable' }),
    reconcile(locations) {
      const location = locations[0];
      entry = location ? { splitId: 'split', location } : undefined;
      notify();
    },
    activate: () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const routes: SplitRoutes = {
  definitions: [
    defineRoute({
      id: 'host',
      path: 'host/:id',
      search: [changesSearch.namespace],
    }),
    defineRoute({ id: 'other', path: 'other' }),
  ],
};

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function mount(url: string) {
  const location = createMemorySplitRouterLocation(url);
  let view!: PaneViewState;
  const Harness = () => {
    view = createPaneViewState();
    return null;
  };
  render(() => (
    <SplitRouter.Root
      layout={createLayout()}
      routes={routes}
      location={location}
    >
      <SplitRouter.Scope splitId="split">
        <Harness />
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  return { location, view: () => view };
}

afterEach(cleanup);

describe('pane view state', () => {
  it('restores the pane from its split search and leaves defaults out of the URL', async () => {
    const { location, view } = mount(
      '/host/s1?s0.changes.pane=full&s0.changes.style=split'
    );
    expect(view().layout()).toBe('full');
    expect(view().diffStyle()).toBe('split');

    view().setLayout('closed');
    await settle();
    view().setDiffStyle('unified');
    await settle();
    expect(location.read().search).toBe('');
  });

  it('records pane moves in history and replaces diff style changes', async () => {
    const { location, view } = mount('/host/s1');
    view().setLayout('split');
    await settle();
    expect(location.read().search).toBe('?s0.changes.pane=split');
    expect(location.history()).toHaveLength(2);

    view().setDiffStyle('split');
    await settle();
    expect(location.read().search).toBe(
      '?s0.changes.pane=split&s0.changes.style=split'
    );
    expect(location.history()).toHaveLength(2);
  });

  it('keeps the state in memory where the route does not own it', async () => {
    const { location, view } = mount('/other');
    expect(view().layout()).toBe('closed');
    view().setLayout('split');
    await settle();
    expect(view().layout()).toBe('split');
    expect(location.read().search).toBe('');
  });
});
