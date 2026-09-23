import { cleanup, render } from '@solidjs/testing-library';
import { type Accessor, onCleanup } from 'solid-js';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createSearchParams,
  type SetSearchParams,
} from '../create-search-params';
import { createMemorySplitRouterLocation } from '../integrations/memory';
import { defineRoute, defineRoutes } from '../routes';
import {
  SplitRouter,
  useCanGo,
  useNavigate,
  useParams,
  useRouteParams,
  useSplitHistory,
  useSplitRouter,
} from '../solid';
import type {
  SplitRouterEntry,
  SplitRouterHistorySnapshot,
  SplitRouterLayout,
  SplitRouterSettledChange,
  SplitRoutes,
} from '../types';

const coercedParamsRoute = defineRoute({
  id: 'coerced-params',
  path: 'coerced/:count',
  params: z.object({ count: z.coerce.number() }),
  component: CoercedParamsView,
});

function CoercedParamsView() {
  const params = useRouteParams(coercedParamsRoute);
  return <div>{`${typeof params.count}:${params.count}`}</div>;
}

function createLayout(): SplitRouterLayout<string> {
  let entry: (SplitRouterEntry & { splitId: string }) | undefined;
  const listeners = new Set<(change: SplitRouterSettledChange) => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener({ history: 'push' });
    }
  };

  return {
    snapshot: () => ({
      entries: entry ? [entry] : [],
    }),
    updateCurrentEntry(_splitId, update) {
      if (!entry) return;
      entry = { splitId: entry.splitId, ...update(entry) };
      notify();
    },
    open: () => {},
    reconcile(entries) {
      const next = entries[0];
      entry = next ? { splitId: 'split', ...next } : undefined;
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
      id: 'drive',
      path: 'drive',
      search: ['drive'],
      children: [
        {
          id: 'drive-folder',
          path: 'folder/:folderId',
          params: z.object({ folderId: z.string() }),
        },
      ],
    }),
  ],
};

type SearchState = {
  sort: 'updated_at' | 'created_at';
  tags: string[];
};

const schema = z.object({
  sort: z.enum(['updated_at', 'created_at']),
  tags: z
    .unknown()
    .transform((value) => (Array.isArray(value) ? value.map(String) : [])),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Solid split router hooks', () => {
  it('reads typed branch params only through the referenced node and stays reactive', () => {
    const tree = defineRoutes({
      definitions: [
        defineRoute({
          id: 'workspace',
          path: 'workspace/:workspaceId/:id',
          params: z.object({ workspaceId: z.string(), id: z.string() }),
          children: [
            defineRoute({
              id: 'count',
              path: 'count/:id',
              params: z.object({ id: z.coerce.number() }),
            }),
          ],
        }),
      ],
    });
    const parent = tree.definitions[0];
    const child = parent.children[0];
    function ParamsView() {
      const parentParams = useParams(parent);
      const childParams = useParams(child);
      const localParams = useRouteParams(child);
      const missing = useParams(
        defineRoute({ id: 'absent', path: 'absent/:id' })
      );
      expectTypeOf(parentParams).toEqualTypeOf<{
        workspaceId: string;
        id: string;
      }>();
      expectTypeOf(childParams).toEqualTypeOf<{
        workspaceId: string;
        id: number;
      }>();
      expectTypeOf(localParams).toEqualTypeOf<{ id: number }>();
      return (
        <div>{`${parentParams.workspaceId}:${parentParams.id}:${childParams.id}:${localParams.id}:${JSON.stringify(missing)}`}</div>
      );
    }
    const location = createMemorySplitRouterLocation(
      '/workspace/a/parent-a/count/2'
    );
    const result = render(() => (
      <SplitRouter.Root
        layout={createLayout()}
        routes={tree}
        location={location}
      >
        <SplitRouter.Scope splitId="split">
          <ParamsView />
        </SplitRouter.Scope>
      </SplitRouter.Root>
    ));
    expect(result.getByText('a:parent-a:2:2:{}')).toBeTruthy();
    location.set('/workspace/b/parent-b/count/3');
    expect(result.getByText('b:parent-b:3:3:{}')).toBeTruthy();
  });

  it('renders the outlet fallback for a missing split without a route-less entry', () => {
    const layout = createLayout();
    const view = render(() => (
      <SplitRouter.Root
        layout={layout}
        routes={routes}
        location={createMemorySplitRouterLocation('/unmatched')}
      >
        <SplitRouter.Outlet
          splitId="missing"
          fallback={() => <div>No split</div>}
        />
      </SplitRouter.Root>
    ));
    expect(layout.snapshot().entries).toEqual([]);
    expect(view.getByText('No split')).toBeTruthy();
  });
  it('returns schema-coerced values from typed route params', () => {
    const location = createMemorySplitRouterLocation('/coerced/42');
    const layout = createLayout();
    const routes: SplitRoutes = {
      definitions: [coercedParamsRoute],
    };
    const result = render(() => (
      <SplitRouter.Root layout={layout} routes={routes} location={location}>
        <SplitRouter.Outlet splitId="split" />
      </SplitRouter.Root>
    ));

    expect(result.getByText('number:42')).toBeTruthy();
  });

  it('renders the pinned mount fallback when the route has no component', () => {
    const location = createMemorySplitRouterLocation('/drive');
    const layout = createLayout();
    const result = render(() => (
      <SplitRouter.Root layout={layout} routes={routes} location={location}>
        <SplitRouter.Outlet
          splitId="split"
          fallback={() => <div>pinned mount</div>}
        />
      </SplitRouter.Root>
    ));

    expect(result.getByText('pinned mount')).toBeTruthy();
  });

  it('keeps matched ancestors mounted when nested params change', async () => {
    let parentMounts = 0;
    let parentDisposals = 0;
    let childMounts = 0;
    let childDisposals = 0;
    let router: ReturnType<typeof useSplitRouter<string>> | undefined;

    const Child = () => {
      childMounts += 1;
      onCleanup(() => {
        childDisposals += 1;
      });
      const params = useParams<{ itemId?: string }>();

      return <div data-testid="child">{params.itemId}</div>;
    };
    const Parent = () => {
      parentMounts += 1;
      onCleanup(() => {
        parentDisposals += 1;
      });
      router = useSplitRouter<string>();

      return (
        <div>
          <div>parent</div>
          <SplitRouter.Outlet />
        </div>
      );
    };
    const nestedRoutes: SplitRoutes = {
      definitions: [
        defineRoute({
          id: 'parent',
          path: 'parent',
          component: Parent,
          children: [
            {
              id: 'child',
              path: 'child/:itemId',
              params: z.object({ itemId: z.string() }),
              component: Child,
            },
          ],
        }),
      ],
    };
    const location = createMemorySplitRouterLocation('/parent/child/one');
    const layout = createLayout();
    const result = render(() => (
      <SplitRouter.Root
        layout={layout}
        routes={nestedRoutes}
        location={location}
      >
        <SplitRouter.Outlet splitId="split" />
      </SplitRouter.Root>
    ));

    const setChild = (itemId: string) => {
      layout.updateCurrentEntry('split', (entry) => ({
        ...entry,
        location: {
          ...entry.location,
          route: {
            matches: [
              { id: 'parent', params: {} },
              { id: 'child', params: { itemId } },
            ],
          },
        },
      }));
    };

    expect(result.getByText('parent')).toBeTruthy();
    expect(parentMounts).toBe(1);

    setChild('one');
    await router?.settled();
    expect(result.getByTestId('child').textContent).toBe('one');
    expect(childMounts).toBe(1);

    setChild('two');
    await router?.settled();
    expect(result.getByTestId('child').textContent).toBe('two');
    expect(parentMounts).toBe(1);
    expect(parentDisposals).toBe(0);
    expect(childMounts).toBe(1);
    expect(childDisposals).toBe(0);
  });

  it('remounts a route component only when its remount key changes', async () => {
    let mounts = 0;
    let disposals = 0;
    let router: ReturnType<typeof useSplitRouter<string>> | undefined;
    const View = () => {
      mounts += 1;
      onCleanup(() => {
        disposals += 1;
      });
      router = useSplitRouter<string>();

      return <div>remountable</div>;
    };
    const remountRoutes: SplitRoutes = {
      definitions: [
        {
          id: 'remountable',
          path: 'remountable/:version',
          params: z.object({ version: z.string() }),
          component: View,
          remountKey: (params) =>
            typeof params.version === 'string' ? params.version : undefined,
        },
      ],
    };
    const location = createMemorySplitRouterLocation('/remountable/one');
    const layout = createLayout();
    render(() => (
      <SplitRouter.Root
        layout={layout}
        routes={remountRoutes}
        location={location}
      >
        <SplitRouter.Outlet splitId="split" />
      </SplitRouter.Root>
    ));

    expect(mounts).toBe(1);
    router?.navigate('split', '/remountable/two');
    await router?.settled();

    expect(mounts).toBe(2);
    expect(disposals).toBe(1);
  });

  it.each(['invalid', 'updated_at'])(
    'canonicalizes %s search with replacement rather than a new history entry',
    async (sort) => {
      const location = createMemorySplitRouterLocation(
        `/drive?s0.drive.sort=${sort}`
      );
      const Harness = () => {
        const [search] = createSearchParams<SearchState>({
          namespace: 'drive',
          schema,
          defaults: { sort: 'updated_at', tags: [] },
        });
        return <div>{search.sort}</div>;
      };
      const view = render(() => (
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
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(view.getByText('updated_at')).toBeTruthy();
      expect(location.read().search).toBe('');
      expect(location.history()).toHaveLength(1);
    }
  );

  it('replaces typed search from defaults and rejects invalid setter values', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive?s0.drive.sort=created_at&s0.drive.tags=old'
    );
    let setSearch: SetSearchParams<SearchState> | undefined;
    const Harness = () => {
      const [search, set] = createSearchParams<SearchState>({
        namespace: 'drive',
        schema,
        defaults: { sort: 'updated_at', tags: [] },
      });
      setSearch = set;
      return <div>{search.sort}</div>;
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
    setSearch?.({ tags: ['new'] }, { mode: 'replace' });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(location.read().search).toBe('?s0.drive.tags=new');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // @ts-expect-error Reject untyped/invalid callers at runtime too.
    setSearch?.({ sort: 'invalid' });
    expect(error).toHaveBeenCalledOnce();
    expect(location.read().search).toBe('?s0.drive.tags=new');
  });

  it('reads route and typed search state from the current split', async () => {
    const location = createMemorySplitRouterLocation(
      '/drive/folder/one?s0.drive.sort=created_at&s0.drive.tags=a&s0.drive.tags=b'
    );
    const layout = createLayout();
    let folderId: string | undefined;
    let search: { sort: string; tags: string[] } | undefined;
    let setSearch:
      | ((
          value: Partial<{
            sort: 'updated_at' | 'created_at';
            tags: string[];
          }>
        ) => void)
      | undefined;
    let navigate: ((to: string) => void) | undefined;
    let canGoBack: Accessor<boolean> | undefined;
    let history: Accessor<SplitRouterHistorySnapshot | undefined> | undefined;

    const Harness = () => {
      const params = useParams<{ folderId?: string }>();
      [search, setSearch] = createSearchParams<SearchState>({
        namespace: 'drive',
        schema,
        defaults: { sort: 'updated_at', tags: [] },
      });
      navigate = useNavigate();
      canGoBack = useCanGo(-1);
      history = useSplitHistory();
      folderId = params.folderId;
      return null;
    };

    render(() => (
      <SplitRouter.Root layout={layout} routes={routes} location={location}>
        <SplitRouter.Scope splitId="split">
          <Harness />
        </SplitRouter.Scope>
      </SplitRouter.Root>
    ));

    expect(folderId).toBe('one');
    expect(search?.sort).toBe('created_at');
    expect(search?.tags).toEqual(['a', 'b']);
    expect(canGoBack?.()).toBe(false);

    setSearch?.({ tags: ['c'] });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(location.read().search).toBe(
      '?s0.drive.sort=created_at&s0.drive.tags=c'
    );

    setSearch?.({ sort: undefined, tags: undefined });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(location.read().search).toBe('');

    navigate?.('folder/two');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(location.read().pathname).toBe('/drive/folder/two');
    expect(canGoBack?.()).toBe(true);
    expect(history?.()?.index).toBe((history?.()?.entries.length ?? 0) - 1);
  });
});
