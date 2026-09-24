import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMemorySplitRouterLocation } from '../integrations/memory';
import * as path from '../path';
import { createSplitRouter } from '../router';
import { defineRoute, rootRouteMatch, routeParams } from '../routes';
import type {
  SplitLocation,
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
  SplitRouterLayout,
  SplitRouterLayoutSnapshot,
  SplitRouterMiddleware,
  SplitRouterSettledChange,
  SplitRoutes,
} from '../types';

type Layout = SplitRouterLayout<string> & {
  reconcileCount(): number;
  updateCount(): number;
  activatedSplitId(): string | undefined;
  swapEntries(): void;
};

const driveFolderRoute = defineRoute({
  id: 'drive-folder',
  path: 'folder/:folderId',
  params: z.object({ folderId: z.string() }),
  claim: ({ folderId }) => ({ namespace: 'folder', id: folderId }),
});

const routes: SplitRoutes = {
  definitions: [
    defineRoute({
      id: 'drive',
      path: 'drive',
      search: ['drive'],
      state: z.record(z.string(), z.unknown()),
      children: [driveFolderRoute],
    }),
    {
      id: 'legacy',
      path: 'legacy/:id',
      params: z.object({ id: z.string() }),
    },
  ],
  globalSearch: ['referral_code'],
};

function createLayout(): Layout {
  let nextId = 0;
  let reconciliations = 0;
  let updates = 0;
  let activatedSplitId: string | undefined;
  let entries: SplitRouterLayoutSnapshot<string>['entries'] = [];
  const listeners = new Set<(change: SplitRouterSettledChange) => void>();

  const notify = (history: 'push' | 'replace' = 'push') => {
    for (const listener of listeners) {
      listener({ history });
    }
  };

  return {
    snapshot: () => ({ entries }),

    updateCurrentLocation(splitId, update) {
      updates += 1;
      entries = entries.map((entry) => {
        if (entry.splitId !== splitId) return entry;
        return { splitId, location: update(entry) };
      });
      notify();
    },

    open({ target, replace, ...entry }) {
      const next = {
        splitId: `split-${++nextId}`,
        ...entry,
      };
      let openedId = next.splitId;
      if (target === 'new-split' || !target) {
        entries = [...entries, next];
      } else {
        const index = entries.findIndex((entry) => entry.splitId === target);

        if (index < 0) {
          entries = [...entries, next];
        } else {
          openedId = entries[index]!.splitId;
          entries = entries.with(index, {
            ...next,
            splitId: openedId,
          });
        }
      }
      notify(replace ? 'replace' : 'push');
      return { status: 'applied', splitId: openedId };
    },

    reconcile(nextLocations) {
      reconciliations++;
      entries = nextLocations.map((location, index) => {
        const current = entries[index];

        return {
          splitId: current?.splitId ?? `split-${++nextId}`,
          location,
        };
      });
      notify('replace');
    },

    activate(splitId) {
      activatedSplitId = splitId;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    reconcileCount: () => reconciliations,
    updateCount: () => updates,
    activatedSplitId: () => activatedSplitId,
    swapEntries() {
      entries = entries.toReversed();
      notify();
    },
  };
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => vi.restoreAllMocks());

describe('split router', () => {
  it('becomes ready when a synchronous layout change supersedes async initialization', async () => {
    const layout = createLayout();
    let release!: () => void;
    let initialSignal: AbortSignal | undefined;
    const initial = new Promise<void>((resolve) => {
      release = resolve;
    });
    const router = createSplitRouter({
      routes,
      layout,
      location: createMemorySplitRouterLocation('/drive'),
      middleware: [
        ({ cause, signal }) => {
          if (cause === 'initial') {
            initialSignal = signal;
            return initial;
          }
        },
      ],
    });
    expect(router.isReady()).toBe(false);
    // Pending cancellation may also notify before the replacement commits.
    const readiness: boolean[] = [];
    router.subscribe(() => readiness.push(router.isReady()));
    layout.open({
      location: {
        route: { matches: [{ id: 'legacy', params: { id: 'replacement' } }] },
      },
      target: 'new-split',
      replace: false,
    });
    await settle();
    expect(initialSignal?.aborted).toBe(true);
    expect(router.isReady()).toBe(true);
    expect(readiness.at(-1)).toBe(true);
    release();
    await router.settled();
    expect(router.isReady()).toBe(true);
    expect(layout.snapshot().entries[0].location.route.matches[0].id).toBe(
      'legacy'
    );
    router.dispose();
  });
  it('observes initial canonicalization echoes without swallowing browser Back', async () => {
    const layout = createLayout();
    const location = createMemorySplitRouterLocation(
      '/legacy/one?referral_code=code'
    );
    const requests: { cause: string; externalSearch?: string }[] = [];
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ to, cause, externalSearch, redirect }) => {
          requests.push({ cause, externalSearch });
          if (rootRouteMatch(to.location.route)?.id === 'legacy') {
            return redirect(
              `/drive/folder/${routeParams(to.location.route).id}`
            );
          }
        },
      ],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0].splitId;
    expect(location.read().pathname).toBe('/drive/folder/one');
    expect(requests).toEqual([
      { cause: 'initial', externalSearch: '?referral_code=code' },
      { cause: 'initial', externalSearch: '?referral_code=code' },
    ]);

    router.navigate(splitId, '/drive/folder/two');
    await router.settled();
    expect(requests.at(-1)).toEqual({
      cause: 'navigate',
      externalSearch: undefined,
    });
    expect(location.history()).toHaveLength(2);
    expect(location.back()).toBe(true);
    await router.settled();
    expect(routeParams(router.route(splitId)!)).toEqual({ folderId: 'one' });
    expect(location.read().pathname).toBe('/drive/folder/one');
    router.dispose();
  });

  it('owns one manifest per router and only shares explicitly supplied state', async () => {
    const compile = vi.spyOn(path, 'compileRoutePattern');
    const layout = createLayout();
    const first = createSplitRouter({
      layout,
      routes,
      location: createMemorySplitRouterLocation('/drive/folder/one'),
    });
    const manifest = first.routes;
    expect(compile).toHaveBeenCalledTimes(3);
    const splitId = layout.snapshot().entries[0]!.splitId;
    first.navigate(splitId, {
      route: driveFolderRoute,
      params: { folderId: 'two' },
    });
    await first.settled();
    first.updateSearch(splitId, 'drive', { sort: ['name'] });
    await first.settled();
    expect(first.href(splitId)).toBe('/drive/folder/two?s0.drive.sort=name');
    expect(first.routes).toBe(manifest);
    expect(compile).toHaveBeenCalledTimes(3);

    const second = createSplitRouter({
      layout: createLayout(),
      routes,
      location: createMemorySplitRouterLocation('/drive'),
    });
    expect(second.routes).not.toBe(manifest);
    expect(second.routes.byId).not.toBe(manifest.byId);
    expect(compile).toHaveBeenCalledTimes(6);

    const adopted = createSplitRouter({
      layout: createLayout(),
      routes: manifest,
      location: createMemorySplitRouterLocation('/drive'),
    });
    expect(adopted.routes).toBe(manifest);
    expect(compile).toHaveBeenCalledTimes(6);
    first.dispose();
    second.dispose();
    adopted.dispose();
  });
  it('rejects unresolved host snapshots before accepting state or committing a URL', () => {
    const layout = createLayout();
    layout.reconcile([{} as SplitLocation]);
    const location = createMemorySplitRouterLocation('/drive');
    expect(() => createSplitRouter({ layout, routes, location })).toThrow(
      'nonempty match branch'
    );
    expect(location.history()).toHaveLength(1);
  });

  it('does not accept malformed middleware proposals into layout or history', () => {
    const layout = createLayout();
    const location = createMemorySplitRouterLocation('/drive');
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ to, cause }) => {
          if (cause === 'navigate')
            to.location.route = { matches: [{ id: 'missing', params: {} }] };
        },
      ],
    });
    const splitId = layout.snapshot().entries[0]!.splitId;
    expect(() => router.navigate(splitId, 'folder/one')).toThrow(
      'invalid match branch'
    );
    expect(router.route(splitId)?.matches[0].id).toBe('drive');
    expect(router.history(splitId)?.entries).toHaveLength(1);
    expect(location.read().pathname).toBe('/drive');
    expect(router.location('missing')).toBeUndefined();
    router.dispose();
  });

  it('keeps same-route search state during relative navigation', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one?s0.drive.sort=created_at'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, 'folder/two');
    await settle();

    expect(location.read()).toMatchObject({
      pathname: '/drive/folder/two',
      search: '?s0.drive.sort=created_at',
      hash: '',
    });

    location.back();
    expect(routeParams(router.location(splitId)?.route).folderId).toBe('one');
    expect(router.canGo(splitId, 1)).toBe(true);
    location.forward();
    expect(routeParams(router.location(splitId)?.route).folderId).toBe('two');
    expect(router.canGo(splitId, -1)).toBe(true);
  });

  it('navigates to a typed route with typed params', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, {
      route: driveFolderRoute,
      params: { folderId: 'two' },
    });
    await router.settled();

    expect(location.read().pathname).toBe('/drive/folder/two');
  });

  it('activates an existing split that owns the same route claim', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const [first, second] = layout.snapshot().entries;

    router.navigate(second!.splitId, {
      route: driveFolderRoute,
      params: { folderId: 'one' },
    });
    await router.settled();

    expect(layout.activatedSplitId()).toBe(first!.splitId);
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/two'
    );
  });

  it('allows callers to bypass a route claim explicitly', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const second = layout.snapshot().entries[1]!;

    router.navigate(
      second.splitId,
      {
        route: driveFolderRoute,
        params: { folderId: 'one' },
      },
      { allowDuplicate: true }
    );
    await router.settled();

    expect(layout.activatedSplitId()).toBeUndefined();
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/one'
    );
  });

  it.each([false, true])(
    'checks final claims after middleware (async: %s)',
    async (asyncMiddleware) => {
      const location = createMemorySplitRouterLocation(
        '/drive/folder/one/~/drive/folder/two'
      );
      const layout = createLayout();
      const router = createSplitRouter({
        layout,
        routes,
        location,
        middleware: [
          ({ cause, path, redirect }) => {
            if (cause !== 'navigate' || path !== '/drive/folder/three') return;
            const result = redirect('/drive/folder/one');
            return asyncMiddleware ? Promise.resolve(result) : result;
          },
        ],
      });
      const [first, second] = layout.snapshot().entries;
      router.navigate(second!.splitId, '/drive/folder/three');
      await router.settled();
      expect(layout.activatedSplitId()).toBe(first!.splitId);
      expect(location.read().pathname).toBe(
        '/drive/folder/one/~/drive/folder/two'
      );
      expect(router.history(second!.splitId)?.entries).toHaveLength(1);
      router.dispose();
    }
  );

  it.each([false, true])(
    'rechecks reentrant navigation at the async commit boundary (new owner: %s)',
    async (newOwner) => {
      const layout = createLayout();
      const location = createMemorySplitRouterLocation(
        '/drive/folder/one/~/drive/folder/two'
      );
      const router = createSplitRouter({
        layout,
        routes,
        location,
        middleware: [
          ({ cause, path, redirect }) => {
            if (cause === 'navigate' && path === '/drive/folder/three') {
              return Promise.resolve(redirect('/drive/folder/shared'));
            }
          },
        ],
      });
      const [first, second] = layout.snapshot().entries;
      let handled = false;
      router.subscribe((splitId) => {
        if (
          handled ||
          splitId !== first!.splitId ||
          routeParams(router.route(splitId)).folderId !== 'shared'
        )
          return;
        handled = true;
        if (newOwner) {
          router.navigate(second!.splitId, '/drive/folder/shared', {
            allowDuplicate: true,
          });
        } else {
          router.navigate(first!.splitId, '/drive/folder/other');
        }
      });
      router.navigate(first!.splitId, '/drive/folder/three');
      await router.settled();
      expect(handled).toBe(true);
      expect(location.read().pathname).toBe(
        newOwner
          ? '/drive/folder/one/~/drive/folder/shared'
          : '/drive/folder/other/~/drive/folder/two'
      );
      if (newOwner) {
        expect(layout.activatedSplitId()).toBe(second!.splitId);
        expect(router.history(first!.splitId)?.entries).toHaveLength(1);
      }
      router.dispose();
    }
  );

  it('does not activate the original claim when middleware redirects away', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause, path, redirect }) => {
          if (cause === 'navigate' && path === '/drive/folder/one')
            return redirect('/drive/folder/three');
        },
      ],
    });
    const second = layout.snapshot().entries[1]!;
    router.navigate(second.splitId, '/drive/folder/one');
    await router.settled();
    expect(layout.activatedSplitId()).toBeUndefined();
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/three'
    );
    router.dispose();
  });

  it.each(['current', 'new-split'] as const)(
    'reserves concurrent claims in request order (%s)',
    async (target) => {
      const gates = [
        Promise.withResolvers<void>(),
        Promise.withResolvers<void>(),
      ];
      let requests = 0;
      const layout = createLayout();
      const location = createMemorySplitRouterLocation(
        '/drive/folder/one/~/drive/folder/two/~/drive/folder/three'
      );
      const router = createSplitRouter({
        layout,
        routes,
        location,
        middleware: [
          ({ cause }) => {
            if (cause === 'navigate') return gates[requests++]!.promise;
          },
        ],
      });
      const [, second, third] = layout.snapshot().entries;
      router.navigate(second!.splitId, '/drive/folder/shared', { target });
      router.navigate(third!.splitId, '/drive/folder/shared', { target });
      gates[1]!.resolve();
      await settle();
      await settle();
      expect(location.read().pathname).not.toContain('shared');
      gates[0]!.resolve();
      await router.settled();
      const entries = layout.snapshot().entries;
      const owners = entries.filter(
        (entry) => routeParams(entry.location.route).folderId === 'shared'
      );
      expect(owners).toHaveLength(1);
      expect(entries).toHaveLength(target === 'new-split' ? 4 : 3);
      expect(layout.activatedSplitId()).toBe(owners[0]!.splitId);
      if (target === 'current') {
        expect(owners[0]!.splitId).toBe(second!.splitId);
        expect(router.history(third!.splitId)?.entries).toHaveLength(1);
      }
      router.dispose();
    }
  );

  it('releases the old reservation when its owner redirects elsewhere', async () => {
    const gate = Promise.withResolvers<void>();
    let requests = 0;
    const layout = createLayout();
    const location = createMemorySplitRouterLocation('/drive');
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        async ({ cause, path, redirect }) => {
          if (cause !== 'navigate' || path !== '/drive/folder/shared') return;
          if (++requests === 1) {
            await gate.promise;
            return redirect('/drive/folder/other');
          }
        },
      ],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    gate.resolve();
    await router.settled();
    expect(
      layout
        .snapshot()
        .entries.map((entry) => routeParams(entry.location.route).folderId)
    ).toEqual([undefined, 'other', 'shared']);
    router.dispose();
  });

  it('releases superseded claims even when the old middleware ignores abort', async () => {
    const gate = Promise.withResolvers<void>();
    let requests = 0;
    const layout = createLayout();
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause, path }) => {
          if (
            cause === 'navigate' &&
            path === '/drive/folder/shared' &&
            ++requests === 1
          )
            return gate.promise;
        },
      ],
    });
    const [first, second] = layout.snapshot().entries;
    router.navigate(first!.splitId, '/drive/folder/shared');
    router.navigate(second!.splitId, '/drive/folder/shared');
    router.navigate(first!.splitId, '/drive/folder/other');
    await router.settled();
    expect(location.read().pathname).toBe(
      '/drive/folder/other/~/drive/folder/shared'
    );
    gate.resolve();
    await settle();
    await settle();
    expect(location.read().pathname).toBe(
      '/drive/folder/other/~/drive/folder/shared'
    );
    router.dispose();
  });

  it('releases a failed transition claim so its next contender can commit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate = Promise.withResolvers<void>();
    let requests = 0;
    const layout = createLayout();
    const location = createMemorySplitRouterLocation('/drive');
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        async ({ cause, to }) => {
          if (cause !== 'navigate' || ++requests !== 1) return;
          await gate.promise;
          to.location.route = { matches: [{ id: 'missing', params: {} }] };
        },
      ],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    gate.resolve();
    await router.settled();
    expect(location.read().pathname).toBe('/drive/~/drive/folder/shared');
    expect(console.error).toHaveBeenCalledWith(
      'Split router transition failed',
      expect.any(Error)
    );
    router.dispose();
  });

  it('bypasses pending and redirected claims with allowDuplicate', async () => {
    const gate = Promise.withResolvers<void>();
    let requests = 0;
    const layout = createLayout();
    const location = createMemorySplitRouterLocation('/drive');
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause, path, redirect }) => {
          if (cause !== 'navigate') return;
          if (path === '/drive/folder/alias')
            return redirect('/drive/folder/shared');
          if (path === '/drive/folder/shared' && ++requests === 1)
            return gate.promise;
        },
      ],
    });
    const splitId = layout.snapshot().entries[0]!.splitId;
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    router.navigate(splitId, '/drive/folder/alias', {
      target: 'new-split',
      allowDuplicate: true,
    });
    await settle();
    expect(location.read().pathname).toBe('/drive/~/drive/folder/shared');
    gate.resolve();
    await router.settled();
    expect(location.read().pathname).toBe('/drive/~/drive/folder/shared');
    router.navigate(splitId, '/drive/folder/alias', {
      target: 'new-split',
      allowDuplicate: true,
    });
    await router.settled();
    expect(location.read().pathname).toBe(
      '/drive/~/drive/folder/shared/~/drive/folder/shared'
    );
    router.dispose();
  });

  it('checks history claims without moving the cursor when another pane owns the destination', async () => {
    const layout = createLayout();
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const router = createSplitRouter({ layout, routes, location });
    const [first, second] = layout.snapshot().entries;
    router.navigate(first!.splitId, '/drive/folder/three');
    router.navigate(second!.splitId, '/drive/folder/one');
    await router.settled();
    router.navigate(first!.splitId, -1);
    await router.settled();
    expect(layout.activatedSplitId()).toBe(second!.splitId);
    expect(router.history(first!.splitId)?.index).toBe(1);
    expect(location.read().pathname).toBe(
      '/drive/folder/three/~/drive/folder/one'
    );
    router.navigate(first!.splitId, -1, { allowDuplicate: true });
    await router.settled();
    expect(router.history(first!.splitId)?.index).toBe(0);
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/one'
    );
    router.dispose();
  });

  it('checks search redirects but preserves same-claim updates in restored duplicate panes', async () => {
    const layout = createLayout();
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/one/~/drive/folder/two'
    );
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause, path, redirect }) => {
          if (cause === 'search' && path === '/drive/folder/two')
            return redirect('/drive/folder/one');
        },
      ],
    });
    const [first, second, third] = layout.snapshot().entries;
    router.updateSearch(second!.splitId, 'drive', { sort: ['name'] });
    await router.settled();
    expect(router.search(second!.splitId, 'drive')).toEqual({ sort: ['name'] });
    expect(layout.activatedSplitId()).toBeUndefined();
    router.updateSearch(third!.splitId, 'drive', { sort: ['name'] });
    await router.settled();
    expect(layout.activatedSplitId()).toBe(first!.splitId);
    expect(router.search(third!.splitId, 'drive')).toBeUndefined();
    expect(router.history(third!.splitId)?.entries).toHaveLength(1);
    router.dispose();
  });

  it('cancels an accepted owner’s pending departure when activating its claim', async () => {
    const gate = Promise.withResolvers<void>();
    const layout = createLayout();
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause, path }) => {
          if (cause === 'navigate' && path === '/drive/folder/three')
            return gate.promise;
        },
      ],
    });
    const [first, second] = layout.snapshot().entries;
    router.navigate(first!.splitId, '/drive/folder/three');
    expect(routeParams(router.route(first!.splitId)).folderId).toBe('three');
    router.navigate(second!.splitId, '/drive/folder/one');
    expect(routeParams(router.route(first!.splitId)).folderId).toBe('one');
    gate.resolve();
    await router.settled();
    expect(layout.activatedSplitId()).toBe(first!.splitId);
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/two'
    );
    router.dispose();
  });

  it('restores external duplicates while canceling reservations and permits a fresh acquisition', async () => {
    const gate = Promise.withResolvers<void>();
    let requests = 0;
    const layout = createLayout();
    const location = createMemorySplitRouterLocation('/drive');
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause }) => {
          if (cause === 'navigate' && ++requests === 1) return gate.promise;
        },
      ],
    });
    const splitId = layout.snapshot().entries[0]!.splitId;
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    location.set('/drive/folder/one/~/drive/folder/one');
    await router.settled();
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/one'
    );
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    await router.settled();
    gate.resolve();
    await settle();
    await settle();
    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/one/~/drive/folder/shared'
    );
    router.dispose();
  });

  it('publishes pending-state removal when a replacement navigation reuses another owner', async () => {
    const gate = Promise.withResolvers<void>();
    const layout = createLayout();
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause, path }) => {
          if (cause === 'navigate' && path === '/drive/folder/three')
            return gate.promise;
        },
      ],
    });
    const [first, second] = layout.snapshot().entries;
    const seen: unknown[] = [];
    router.subscribe((splitId) => {
      if (splitId === second!.splitId)
        seen.push(routeParams(router.route(splitId)).folderId);
    });
    router.navigate(second!.splitId, '/drive/folder/three');
    router.navigate(second!.splitId, '/drive/folder/one');
    expect(seen).toEqual(['three', 'two']);
    expect(layout.activatedSplitId()).toBe(first!.splitId);
    gate.resolve();
    await router.settled();
    router.dispose();
  });

  it('cancels pending reservations on disposal and ignores subsequent navigation', async () => {
    const gate = Promise.withResolvers<void>();
    let requests = 0;
    const layout = createLayout();
    const location = createMemorySplitRouterLocation('/drive');
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause }) => {
          if (cause === 'navigate' && ++requests === 1) return gate.promise;
        },
      ],
    });
    const splitId = layout.snapshot().entries[0]!.splitId;
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    router.navigate(splitId, '/drive/folder/shared', { target: 'new-split' });
    router.dispose();
    gate.resolve();
    await router.settled();
    router.navigate(splitId, '/drive/folder/other');
    router.updateSearch(splitId, 'drive', { sort: ['name'] });
    expect(location.read().pathname).toBe('/drive');
    expect(location.read().search).toBe('');
  });

  it('traverses route history without changing another split', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/other'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const [first, second] = layout.snapshot().entries;

    router.navigate(first!.splitId, '/drive/folder/two');
    router.navigate(first!.splitId, '/drive/folder/three');
    await router.settled();

    expect(router.canGo(first!.splitId, -2)).toBe(true);
    router.navigate(first!.splitId, -1);
    await router.settled();

    expect(routeParams(router.route(first!.splitId)).folderId).toBe('two');
    expect(routeParams(router.route(second!.splitId)).folderId).toBe('other');
    expect(router.canGo(first!.splitId, 1)).toBe(true);
    expect(router.history(first!.splitId)?.index).toBe(1);
    expect(router.history(first!.splitId)?.entries).toHaveLength(3);

    router.navigate(first!.splitId, 1);
    await router.settled();
    expect(routeParams(router.route(first!.splitId)).folderId).toBe('three');
  });

  it('ignores navigation and search writes that resolve to the current destination', async () => {
    const middleware = vi.fn<SplitRouterMiddleware>(() => undefined);
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one?s0.drive.sort=name'
    );
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [middleware],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;
    const listener = vi.fn();
    router.subscribe(listener);
    middleware.mockClear();
    const committed = location.history().length;

    router.navigate(splitId, '/drive/folder/one');
    router.navigate(splitId, {
      route: driveFolderRoute,
      params: { folderId: 'one' },
    });
    router.navigate(splitId, '/drive/folder/one', { replace: true });
    router.updateSearch(splitId, 'drive', { sort: ['name'] });
    await router.settled();

    expect(middleware).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(location.history()).toHaveLength(committed);
    expect(router.canGo(splitId, -1)).toBe(false);

    // A real change still transitions.
    router.updateSearch(splitId, 'drive', { sort: ['size'] });
    await router.settled();
    expect(middleware).toHaveBeenCalledOnce();
    expect(location.read().search).toBe('?s0.drive.sort=size');
  });

  it('pushes a repeated route as a new history entry', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two');
    await router.settled();
    router.navigate(splitId, '/drive/folder/one');
    await router.settled();
    router.navigate(splitId, -1);
    await router.settled();

    expect(routeParams(router.route(splitId)).folderId).toBe('two');
  });

  it('restores distinct state for duplicate URLs across browser Back and Forward', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/one', {
      state: { breadcrumb: 'first' },
    });
    await router.settled();
    router.navigate(splitId, '/drive/folder/one', {
      state: { breadcrumb: 'second' },
    });
    await router.settled();

    expect(layout.updateCount()).toBe(0);
    const entries = router.history(splitId)!.entries;
    expect(entries).toHaveLength(3);
    expect(entries[1]?.key).not.toBe(entries[2]?.key);
    expect(router.entry(splitId)?.state).toEqual({ breadcrumb: 'second' });

    expect(location.back()).toBe(true);
    await router.settled();
    expect(router.entry(splitId)?.state).toEqual({ breadcrumb: 'first' });

    expect(location.forward()).toBe(true);
    await router.settled();
    expect(router.entry(splitId)?.state).toEqual({ breadcrumb: 'second' });

    router.navigate(splitId, '/drive/folder/one', {
      replace: true,
      state: { breadcrumb: 'replacement' },
    });
    await router.settled();
    expect(location.history()).toHaveLength(3);
    expect(router.entry(splitId)?.state).toEqual({
      breadcrumb: 'replacement',
    });
    expect(location.back()).toBe(true);
    await router.settled();
    expect(location.forward()).toBe(true);
    await router.settled();
    expect(router.entry(splitId)?.state).toEqual({
      breadcrumb: 'replacement',
    });
  });

  it('preserves router metadata when duplicate-URL panes swap', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/one'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const [first, second] = layout.snapshot().entries;

    router.navigate(first!.splitId, '/drive/folder/one', {
      state: { breadcrumb: 'first' },
    });
    router.navigate(second!.splitId, '/drive/folder/one', {
      state: { breadcrumb: 'second' },
    });
    await router.settled();
    const browserStateBeforeSwap = location.read().state;

    layout.swapEntries();
    await router.settled();

    expect(layout.snapshot().entries.map((entry) => entry.splitId)).toEqual([
      second!.splitId,
      first!.splitId,
    ]);
    expect(router.entry(first!.splitId)?.state).toEqual({
      breadcrumb: 'first',
    });
    expect(router.entry(second!.splitId)?.state).toEqual({
      breadcrumb: 'second',
    });
    expect(location.read().state).not.toEqual(browserStateBeforeSwap);
  });

  it('observes a duplicate-pane swap during a queued layout echo', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const first = layout.snapshot().entries[0]!;

    router.navigate(first.splitId, '/drive/folder/one', {
      state: { breadcrumb: 'first' },
    });
    await router.settled();
    router.navigate(first.splitId, '/drive/folder/one', {
      target: 'new-split',
      allowDuplicate: true,
      state: { breadcrumb: 'second' },
    });
    const browserStateBeforeSwap = location.read().state;

    layout.swapEntries();
    await router.settled();

    expect(location.read().state).not.toEqual(browserStateBeforeSwap);
    const second = layout
      .snapshot()
      .entries.find((entry) => entry.splitId !== first.splitId)!;
    expect(layout.snapshot().entries[0]?.splitId).toBe(second.splitId);
    expect(router.entry(first.splitId)?.state).toEqual({
      breadcrumb: 'first',
    });
    expect(router.entry(second.splitId)?.state).toEqual({
      breadcrumb: 'second',
    });
  });

  it('snapshots cloneable state and drops state that cannot be cloned', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;
    const state = { breadcrumbs: ['one'] };

    router.navigate(splitId, '/drive/folder/two', { state });
    state.breadcrumbs.push('mutated');
    await router.settled();

    expect(router.entry(splitId)?.state).toEqual({ breadcrumbs: ['one'] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    router.navigate(splitId, '/drive/folder/three', {
      state: { callback: () => undefined },
    });
    await router.settled();

    expect(routeParams(router.route(splitId)).folderId).toBe('three');
    expect(router.entry(splitId)?.state).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('passes parsed output to state updaters without reparsing it', async () => {
    let parses = 0;
    const stateRoute = defineRoute({
      id: 'state',
      path: 'state',
      state: z.object({ value: z.string() }).transform(({ value }) => ({
        value,
        parseNumber: ++parses,
      })),
    });
    const location = createMemorySplitRouterLocation('/state');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes: { definitions: [stateRoute] },
      location,
    });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/state', { state: { value: 'first' } });
    await router.settled();
    expect(router.entry(splitId)?.state).toEqual({
      value: 'first',
      parseNumber: 1,
    });

    router.navigate(splitId, '/state', {
      state: (current) => ({
        value: `${(current as { value: string }).value}-second`,
      }),
    });
    await router.settled();
    expect(router.entry(splitId)?.state).toEqual({
      value: 'first-second',
      parseNumber: 2,
    });
  });

  it('rejects local state that the destination route does not accept', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    expect(() =>
      router.navigate(splitId, '/drive/folder/two', { state: 'invalid' })
    ).toThrow('rejected navigation state');
    expect(() =>
      router.navigate(splitId, '/legacy/one', {
        state: { unsupported: true },
      })
    ).toThrow('rejected navigation state');
    expect(routeParams(router.route(splitId)).folderId).toBe('one');
  });

  it('validates navigation state against a middleware redirect destination', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ path, redirect }) =>
          path === '/drive/folder/two' ? redirect('/legacy/two') : undefined,
      ],
    });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two', {
      state: { breadcrumb: 'two' },
    });
    await router.settled();

    expect(rootRouteMatch(router.route(splitId))?.id).toBe('legacy');
    expect(router.entry(splitId)?.state).toBeUndefined();
  });

  it('drops restored state that the destination route does not accept', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    location.set(
      {
        pathname: '/drive/folder/two',
        search: '',
        hash: '',
        state: {
          __macroSplitRouter: {
            entries: [{ key: 'restored-entry', state: 'invalid' }],
          },
        },
      },
      { replace: true }
    );
    await router.settled();

    expect(routeParams(router.route(splitId)).folderId).toBe('two');
    expect(router.entry(splitId)?.state).toBeUndefined();
  });

  it('treats an external URL without state as a fresh entry', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/one', {
      replace: true,
      state: { breadcrumb: 'stored' },
    });
    await router.settled();
    const storedKey = router.entry(splitId)?.key;

    location.set('/drive/folder/one', { replace: true });
    await router.settled();

    expect(router.entry(splitId)?.key).not.toBe(storedKey);
    expect(router.entry(splitId)?.state).toBeUndefined();
  });

  it('preserves entry state through search pushes and replacements', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two', {
      state: (current) => ({ previous: current, breadcrumb: 'two' }),
    });
    await router.settled();
    const routeKey = router.entry(splitId)?.key;
    const state = router.entry(splitId)?.state;

    router.updateSearch(splitId, 'drive', { sort: ['name'] });
    await router.settled();
    const pushedKey = router.entry(splitId)?.key;
    expect(pushedKey).not.toBe(routeKey);
    expect(router.entry(splitId)?.state).toBe(state);

    router.updateSearch(
      splitId,
      'drive',
      { sort: ['created_at'] },
      { history: 'replace' }
    );
    await router.settled();
    expect(router.entry(splitId)?.key).toBe(pushedKey);
    expect(router.entry(splitId)?.state).toBe(state);
  });

  it('restores search state during history traversal', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.updateSearch(splitId, 'drive', { sort: ['name'] });
    await router.settled();
    expect(router.search(splitId, 'drive')).toEqual({ sort: ['name'] });

    router.navigate(splitId, -1);
    await router.settled();
    expect(router.search(splitId, 'drive')).toBeUndefined();

    router.navigate(splitId, 1);
    await router.settled();
    expect(router.search(splitId, 'drive')).toEqual({ sort: ['name'] });
  });

  it('replaces history and truncates forward entries', async () => {
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two', { replace: true });
    await router.settled();
    expect(router.canGo(splitId, -1)).toBe(false);

    router.navigate(splitId, '/drive/folder/three');
    await router.settled();
    router.navigate(splitId, -1);
    await router.settled();
    router.navigate(splitId, '/drive/folder/four');
    await router.settled();

    expect(router.canGo(splitId, 1)).toBe(false);
    expect(routeParams(router.route(splitId)).folderId).toBe('four');
  });

  it('runs history traversal through middleware', async () => {
    const causes: string[] = [];
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause }) => {
          causes.push(cause);
        },
      ],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two');
    await router.settled();
    router.navigate(splitId, -1);
    await router.settled();

    expect(causes).toContain('history');
    expect(routeParams(router.route(splitId)).folderId).toBe('one');
  });

  it('waits for async middleware before applying history traversal', async () => {
    let release!: () => void;
    let blockHistory = false;
    const preload = new Promise<void>((resolve) => {
      release = resolve;
    });
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ cause }) =>
          cause === 'history' && blockHistory ? preload : undefined,
      ],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two');
    await router.settled();
    blockHistory = true;
    router.navigate(splitId, -1);

    expect(location.read().pathname).toBe('/drive/folder/two');
    expect(routeParams(router.route(splitId)).folderId).toBe('one');

    release();
    await router.settled();

    expect(location.read().pathname).toBe('/drive/folder/one');
    expect(routeParams(router.route(splitId)).folderId).toBe('one');
  });

  it('commits route and search updates together', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one?s0.drive.scope=all&s0.drive.sort=created_at'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, 'folder/two', {
      search: {
        drive(current = {}) {
          const next = { ...current };

          delete next.scope;

          return next;
        },
      },
    });
    await settle();

    expect(location.history()).toHaveLength(2);
    expect(location.read()).toMatchObject({
      pathname: '/drive/folder/two',
      search: '?s0.drive.sort=created_at',
      hash: '',
    });
  });

  it('applies search writes without losing the latest value', async () => {
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.updateSearch(
      splitId,
      'drive',
      { sort: ['name'] },
      { history: 'replace' }
    );
    router.updateSearch(
      splitId,
      'drive',
      { sort: ['created_at'] },
      { history: 'push' }
    );
    await settle();

    expect(location.history()).toHaveLength(2);
    expect(location.read().search).toBe('?s0.drive.sort=created_at');
  });

  it('drops unowned route search and rejects writes to it', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive?s0.drive.sort=name&s0.other.value=ignored'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;
    await settle();

    expect(router.search(splitId, 'drive')).toEqual({ sort: ['name'] });
    expect(router.search(splitId, 'other')).toBeUndefined();
    expect(location.read().search).toBe('?s0.drive.sort=name');
    expect(() =>
      router.updateSearch(splitId, 'other', { value: ['nope'] })
    ).toThrow('Split route does not own search namespace "other"');
    expect(() =>
      router.navigate(splitId, 'folder/one', {
        search: { other: { value: ['nope'] } },
      })
    ).toThrow('Split route does not own search namespace "other"');
    expect(() => router.updateSearch('missing', 'bad.name', {})).toThrow(
      'Invalid split search namespace "bad.name"'
    );
    expect(location.read().pathname).toBe('/drive');
    expect(location.read().search).toBe('?s0.drive.sort=name');
  });

  it('merges rapid search writes while middleware is pending', async () => {
    const middleware: SplitRouterMiddleware[] = [
      async ({ cause }) => {
        if (cause === 'search') await Promise.resolve();
      },
    ];
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware,
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.updateSearch(splitId, 'drive', { sort: ['name'] });
    router.updateSearch(splitId, 'drive', (current = {}) => ({
      ...current,
      type: ['pdf'],
    }));
    await router.settled();

    expect(router.search(splitId, 'drive')).toEqual({
      sort: ['name'],
      type: ['pdf'],
    });
    expect(location.read().search).toBe(
      '?s0.drive.sort=name&s0.drive.type=pdf'
    );
  });

  it('publishes one state change for synchronous search middleware', async () => {
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [() => undefined],
    });
    const splitId = layout.snapshot().entries[0]!.splitId;
    const notifications: Array<string | undefined> = [];
    router.subscribe((notifiedSplitId) => notifications.push(notifiedSplitId));

    router.updateSearch(splitId, 'drive', { type: ['pdf'] });
    await router.settled();

    expect(notifications).toEqual([splitId]);
    expect(location.read().search).toBe('?s0.drive.type=pdf');
  });

  it('scopes direct layout reconciliation to the changed split', async () => {
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [
        ({ to, redirect }) =>
          rootRouteMatch(to.location.route)?.id === 'legacy'
            ? redirect('/drive/folder/redirected')
            : undefined,
      ],
    });
    const notifications: Array<string | undefined> = [];
    router.subscribe((splitId) => notifications.push(splitId));

    layout.open({
      location: {
        route: {
          matches: [{ id: 'legacy', params: { id: 'document' } }],
        },
      },
      target: 'new-split',
    });
    await router.settled();

    const changedSplitId = layout.snapshot().entries[1]!.splitId;
    expect(notifications).toEqual([changedSplitId]);
  });

  it('evaluates functional navigation search updates once', async () => {
    let calls = 0;
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [() => undefined],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two', {
      search: {
        drive(current = {}) {
          calls++;
          return { ...current, count: [String(calls)] };
        },
      },
    });
    await router.settled();

    expect(calls).toBe(1);
    expect(location.read().search).toBe('?s0.drive.count=1');
  });

  it('waits for async middleware before programmatic navigation', async () => {
    let release!: () => void;
    const preload = new Promise<void>((resolve) => {
      release = resolve;
    });
    const middleware: SplitRouterMiddleware[] = [
      ({ cause }) => (cause === 'navigate' ? preload : undefined),
    ];
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware,
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two');

    expect(location.read().pathname).toBe('/drive/folder/one');
    expect(
      routeParams(layout.snapshot().entries[0]?.location?.route).folderId
    ).toBe('one');
    expect(routeParams(router.location(splitId)?.route).folderId).toBe('two');

    release();
    await router.settled();

    expect(location.read().pathname).toBe('/drive/folder/two');
    expect(routeParams(router.location(splitId)?.route).folderId).toBe('two');
  });

  it('does not cancel middleware running for another split', async () => {
    let releaseFirst!: () => void;
    const firstPreload = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstSignal: AbortSignal | undefined;
    const middleware: SplitRouterMiddleware[] = [
      ({ cause, path, signal }) => {
        if (cause === 'navigate' && path.endsWith('/one')) {
          firstSignal = signal;
          return firstPreload;
        }
      },
    ];
    const location = createMemorySplitRouterLocation('/drive/~/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware,
    });
    await router.settled();
    const [first, second] = layout.snapshot().entries;

    router.navigate(first!.splitId, '/drive/folder/one');
    router.navigate(second!.splitId, '/drive/folder/two');
    await settle();
    await settle();

    expect(firstSignal?.aborted).toBe(false);
    expect(location.read().pathname).toBe('/drive/~/drive/folder/two');

    releaseFirst();
    await router.settled();

    expect(location.read().pathname).toBe(
      '/drive/folder/one/~/drive/folder/two'
    );
  });

  it('cancels stale middleware when a newer navigation starts', async () => {
    let firstSignal: AbortSignal | undefined;
    const middleware: SplitRouterMiddleware[] = [
      ({ cause, path, signal }) => {
        if (cause !== 'navigate' || !path.endsWith('/one')) return;

        firstSignal = signal;
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      },
    ];
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware,
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/one');
    router.navigate(splitId, '/drive/folder/two');
    await router.settled();

    expect(firstSignal?.aborted).toBe(true);
    expect(location.read().pathname).toBe('/drive/folder/two');
  });

  it('delays Back/Forward reconciliation until middleware settles', async () => {
    let release!: () => void;
    let blockExternal = false;
    const preload = new Promise<void>((resolve) => {
      release = resolve;
    });
    const middleware: SplitRouterMiddleware[] = [
      ({ cause }) =>
        cause === 'external' && blockExternal ? preload : undefined,
    ];
    const location = createMemorySplitRouterLocation('/drive/folder/one');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware,
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, '/drive/folder/two');
    await router.settled();
    blockExternal = true;
    location.back();

    expect(location.read().pathname).toBe('/drive/folder/one');
    expect(
      routeParams(layout.snapshot().entries[0]?.location?.route).folderId
    ).toBe('two');

    release();
    await router.settled();

    expect(
      routeParams(layout.snapshot().entries[0]?.location?.route).folderId
    ).toBe('one');
  });

  it('accepts Back to a URL whose outbound write was coalesced', async () => {
    let current: SplitRouterExternalLocationValue = {
      pathname: '/drive',
      search: '',
      hash: '',
    };
    const pending: SplitRouterExternalLocationValue[] = [];
    const listeners = new Set<
      (location: SplitRouterExternalLocationValue) => void
    >();
    const location: SplitRouterExternalLocation = {
      read: () => current,
      commit: (next) => pending.push(next),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const flush = (index = 0) => {
      current = pending.splice(index, 1)[0]!;
      for (const listener of listeners) listener(current);
    };
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;
    // Initialization adds the router's opaque entry metadata with replacement.
    flush();

    router.updateSearch(splitId, 'drive', { sort: ['name'] });
    router.updateSearch(splitId, 'drive', { sort: ['created_at'] });

    const earlier = pending[0]!;
    flush(1);
    pending.length = 0; // The adapter discards the superseded write.
    expect(router.search(splitId, 'drive')).toEqual({ sort: ['created_at'] });

    // A later browser Back reaches the same URL as that superseded write.
    current = earlier;
    for (const listener of listeners) listener(current);
    await settle();

    expect(pending).toHaveLength(0);
    expect(router.search(splitId, 'drive')).toEqual({ sort: ['name'] });
    expect(location.read().search).toBe('?s0.drive.sort=name');
  });

  it('skips layout reconciliation for an identical external location', () => {
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    createSplitRouter({
      layout,
      routes,
      location,
      middleware: [() => undefined],
    });

    expect(layout.reconcileCount()).toBe(1);

    location.set('/drive', { replace: true });

    expect(layout.reconcileCount()).toBe(1);
  });

  it('restores duplicate routes by visible position', () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one/~/drive/folder/two'
    );
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const [first, second] = layout.snapshot().entries;

    location.set('/drive/folder/three/~/drive/folder/four', { replace: true });

    expect(routeParams(router.location(first!.splitId)?.route).folderId).toBe(
      'three'
    );
    expect(routeParams(router.location(second!.splitId)?.route).folderId).toBe(
      'four'
    );
  });

  it('opens an explicitly requested new split', async () => {
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({ layout, routes, location });
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, 'folder/two', {
      target: 'new-split',
    });
    await settle();

    expect(layout.snapshot().entries).toHaveLength(2);
    expect(location.read().pathname).toBe('/drive/~/drive/folder/two');
  });

  it('waits for async middleware before opening a new split', async () => {
    let release!: () => void;
    const preload = new Promise<void>((resolve) => {
      release = resolve;
    });
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const router = createSplitRouter({
      layout,
      routes,
      location,
      middleware: [({ cause }) => (cause === 'navigate' ? preload : undefined)],
    });
    await router.settled();
    const splitId = layout.snapshot().entries[0]!.splitId;

    router.navigate(splitId, 'folder/two', { target: 'new-split' });

    expect(layout.snapshot().entries).toHaveLength(1);

    release();
    await router.settled();

    expect(layout.snapshot().entries).toHaveLength(2);
    expect(location.read().pathname).toBe('/drive/~/drive/folder/two');
  });

  it('retains declared global search and drops unowned keys', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive?referral_code=abc&temporary=value'
    );
    const layout = createLayout();
    createSplitRouter({ layout, routes, location });

    await settle();

    expect(location.read().search).toBe('?referral_code=abc');
  });
});
