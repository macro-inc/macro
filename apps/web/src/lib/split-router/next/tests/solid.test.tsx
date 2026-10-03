import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createEffect, For, type JSX, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMemoryHistory, type MemoryHistory } from '../history/memory';
import { createMemoryPaneStore } from '../panes/memory-store';
import { createSplitRouter, type SplitRouter } from '../router/create-router';
import { defineRoute } from '../routes/define';
import type {
  Entry,
  PaneId,
  SplitRouteState,
  SplitRoutes,
} from '../routes/types';
import { SplitRouterProvider, useSplitRouter } from '../solid/context';
import { createSearchParams } from '../solid/create-search-params';
import {
  useCanGo,
  useMatches,
  useNavigate,
  usePane,
  usePendingNavigation,
  useRouteParams,
} from '../solid/hooks';
import { Outlet } from '../solid/outlet';
import { PaneScope } from '../solid/pane-scope';
import { Route } from '../solid/route';
import { Router } from '../solid/router';
import { useBeforeLeave } from '../solid/use-before-leave';
import { createTestPolicy } from './fixtures';

const counts = { drive: 0, document: 0 };
const documentTypeReads = vi.fn();
let allowLeave = true;

const documentRoute = defineRoute({
  id: 'document',
  path: ':documentType/:documentId',
  params: z.object({
    documentType: z.enum(['md', 'pdf']),
    documentId: z.string().min(1),
  }),
  remountKey: ({ documentType }) => documentType,
  component: DocumentView,
});

function DocumentView() {
  const params = useRouteParams(documentRoute);
  onMount(() => {
    counts.document += 1;
  });
  createEffect(() => documentTypeReads(params.documentType));
  return (
    <p data-testid="document">{`${params.documentType}:${params.documentId}`}</p>
  );
}

function DriveView() {
  const navigate = useNavigate();
  onMount(() => {
    counts.drive += 1;
  });
  return (
    <div>
      <button type="button" onClick={() => navigate('md/d3')}>
        relative
      </button>
      <Outlet />
    </div>
  );
}

function GuardedView() {
  useBeforeLeave(() => allowLeave);
  return <p data-testid="guarded">guarded</p>;
}

function ListView() {
  const [search, setSearch] = createSearchParams({
    namespace: 'list',
    schema: z.object({ sort: z.enum(['name', 'date']) }),
    defaults: { sort: 'name' as 'name' | 'date' },
  });
  return (
    <button type="button" onClick={() => setSearch({ sort: 'date' })}>
      {`sort:${search.sort}`}
    </button>
  );
}

const runs: Record<string, number> = {};
const bump = (key: string) => {
  runs[key] = (runs[key] ?? 0) + 1;
};

/** Counts every reader a search change could wake, per pane. */
function ProbeView() {
  const pane = usePane();
  const [probe, setProbe] = createSearchParams({
    namespace: 'probe',
    schema: z.object({
      sort: z.enum(['name', 'date']),
      tags: z.array(z.string()),
    }),
    defaults: { sort: 'name' as 'name' | 'date', tags: ['all'] },
  });
  const [other] = createSearchParams({
    namespace: 'other',
    schema: z.object({ tab: z.enum(['a', 'b']) }),
    defaults: { tab: 'a' as 'a' | 'b' },
  });
  const matches = useMatches();
  const pending = usePendingNavigation();
  const canGoForward = useCanGo(1);
  const count = (reader: string) => bump(`${pane()}:${reader}`);

  onMount(() => count('mount'));
  createEffect(() => count(`sort=${probe.sort}`));
  createEffect(() => count(`tags=${probe.tags.join()}`));
  createEffect(() => count(`tab=${other.tab}`));
  createEffect(() => count(`matches=${matches().length}`));
  createEffect(() => count(`pending=${pending()?.phase ?? 'none'}`));
  createEffect(() => count(`canGo=${canGoForward()}`));

  const toggle = () => {
    const sort = probe.sort === 'name' ? 'date' : 'name';

    setProbe({ sort }, { history: 'replace' });
  };

  return (
    <button type="button" onClick={toggle}>
      {`probe:${pane()}`}
    </button>
  );
}

const paneRoutes = [
  defineRoute({
    id: 'drive',
    path: 'drive',
    component: DriveView,
    children: [documentRoute],
  }),
  defineRoute({
    id: 'probe',
    path: 'probe',
    search: ['probe', 'other'],
    component: ProbeView,
  }),
  defineRoute({ id: 'home', path: 'home', component: () => <p>home</p> }),
  defineRoute({ id: 'guarded', path: 'guarded', component: GuardedView }),
  defineRoute({
    id: 'list',
    path: 'list',
    search: ['list'],
    component: ListView,
  }),
];

const routes: SplitRoutes = {
  definitions: [
    defineRoute({ id: 'login', path: 'login', component: () => <p>login</p> }),
    defineRoute({ id: 'app', children: paneRoutes }),
  ],
  defaultRoute: () => ({
    matches: [
      { id: 'app', params: {} },
      { id: 'home', params: {} },
    ],
  }),
};

function PanelHeader() {
  const matches = useMatches();
  const canGoBack = useCanGo(-1);
  const trail = () => matches().map((match) => match.id);

  return (
    <header data-testid="header">
      {`${trail().join('/')} back:${canGoBack()}`}
    </header>
  );
}

function GuardedChrome() {
  useBeforeLeave(() => allowLeave);

  return null;
}

function Panel(props: { pane: PaneId }) {
  return (
    <PaneScope pane={props.pane}>
      <PanelHeader />
      <Outlet />
    </PaneScope>
  );
}

function renderRouter(
  url: string,
  view: (router: SplitRouter) => JSX.Element,
  routeTable: SplitRoutes = routes
) {
  const history: MemoryHistory = createMemoryHistory(url);
  let router: SplitRouter | undefined;
  render(() => {
    const created = createSplitRouter({
      routes: routeTable,
      history,
      paneStore: createMemoryPaneStore(),
      policy: createTestPolicy().policy,
    });
    router = created;
    onCleanup(() => created.dispose());
    return (
      <SplitRouterProvider router={created}>
        {view(created)}
      </SplitRouterProvider>
    );
  });
  return { history, router: router! };
}

function renderPanes(
  url: string,
  renderPane: (pane: PaneId) => JSX.Element = (pane) => <Outlet pane={pane} />
) {
  return renderRouter(url, (router) => (
    <For each={router.panes()}>{renderPane}</For>
  ));
}

beforeEach(() => {
  counts.drive = 0;
  counts.document = 0;
  documentTypeReads.mockClear();
  allowLeave = true;

  for (const key of Object.keys(runs)) {
    delete runs[key];
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('split router Solid bindings', () => {
  it('keeps a view mounted while its remount key holds and updates params in place', () => {
    const { router } = renderPanes('/drive/md/d1');
    const pane = router.panes()[0]!;
    expect(screen.getByTestId('document').textContent).toBe('md:d1');

    router.navigatePane(pane, '/drive/md/d2');
    expect(screen.getByTestId('document').textContent).toBe('md:d2');
    expect(counts).toEqual({ drive: 1, document: 1 });
    expect(documentTypeReads).toHaveBeenCalledTimes(1);

    router.navigatePane(pane, '/drive/pdf/d2');
    expect(counts).toEqual({ drive: 1, document: 2 });
  });

  it('lets panel chrome around a prop-less outlet use the hooks', () => {
    const { router } = renderPanes('/drive/md/d1', (pane) => (
      <Panel pane={pane} />
    ));
    const pane = router.panes()[0]!;
    expect(screen.getByTestId('header').textContent).toBe(
      'app/drive/document back:false'
    );
    expect(screen.getByTestId('document').textContent).toBe('md:d1');

    router.navigatePane(pane, '/home');
    expect(screen.getByTestId('header').textContent).toBe('app/home back:true');
    expect(screen.getByText('home')).toBeTruthy();
  });

  it('asks a guard in pane chrome before the pane closes, not on navigations inside it', async () => {
    const { router } = renderPanes('/home/~/drive/md/d1', (pane) => (
      <PaneScope pane={pane}>
        <GuardedChrome />
        <Outlet />
      </PaneScope>
    ));
    const second = router.panes()[1]!;
    allowLeave = false;

    expect(router.navigatePane(second, '/home')).toMatchObject({
      status: 'committed',
    });
    expect(await router.close(second)).toBe(false);

    allowLeave = true;
    expect(await router.close(second)).toBe(true);
    expect(router.panes()).toHaveLength(1);
  });

  it('renders the first pane’s top-level route at the root, and a layout route renders each pane below it', async () => {
    function PaneLayout() {
      const router = useSplitRouter();
      return (
        <For each={router.panes()}>
          {(pane) => (
            <section data-testid="pane">
              <PaneScope pane={pane}>
                <GuardedChrome />
                <Outlet />
              </PaneScope>
            </section>
          )}
        </For>
      );
    }
    const layoutRoutes: SplitRoutes = {
      ...routes,
      definitions: [
        routes.definitions[0]!,
        defineRoute({ id: 'app', component: PaneLayout, children: paneRoutes }),
      ],
    };
    const { router, history } = renderRouter(
      '/home/~/drive',
      () => <Outlet />,
      layoutRoutes
    );
    expect(screen.getAllByTestId('pane')).toHaveLength(2);
    expect(screen.getByText('home')).toBeTruthy();
    expect(counts.drive).toBe(1);

    allowLeave = false;
    const second = router.panes()[1]!;
    expect(router.navigatePane(second, '/home')).toMatchObject({
      status: 'committed',
    });
    expect(screen.getAllByText('home')).toHaveLength(2);
    expect(await router.close(second)).toBe(false);

    allowLeave = true;
    await router.navigatePane(router.panes()[0]!, '/login');
    expect(screen.getByText('login')).toBeTruthy();
    expect(screen.queryAllByTestId('pane')).toHaveLength(0);
    expect(history.read().path).toBe('/login');
  });

  it('re-runs only the readers of the search field that changed', () => {
    let paneRenders = 0;
    const { router } = renderPanes('/probe/~/probe', (pane) => {
      paneRenders += 1;

      return <Outlet pane={pane} />;
    });
    const [first, second] = router.panes();
    const before = { ...runs };

    fireEvent.click(screen.getByText(`probe:${first}`));

    const woken = Object.keys(runs).filter((key) => runs[key] !== before[key]);
    expect(woken).toEqual([`${first}:sort=date`]);
    expect(paneRenders).toBe(2);
    expect(runs[`${second}:mount`]).toBe(1);
  });

  it('resolves relative paths against the calling route', () => {
    renderPanes('/drive/md/d1');
    fireEvent.click(screen.getByText('relative'));
    expect(screen.getByTestId('document').textContent).toBe('md:d3');
  });

  it('runs leave guards before unmounting a view but not for search changes', () => {
    const { router, history } = renderPanes('/guarded');
    const pane = router.panes()[0]!;
    allowLeave = false;
    router.navigatePane(pane, '/home');
    expect(screen.getByTestId('guarded')).toBeTruthy();
    router.updateSearch(pane, 'anything', { x: ['1'] });
    expect(history.read().search).toBe('?s0.anything.x=1');
    allowLeave = true;
    router.navigatePane(pane, '/home');
    expect(screen.queryByTestId('guarded')).toBeNull();
  });

  it('reads and writes one search namespace and rewrites invalid values', () => {
    const { history } = renderPanes('/list?s0.list.sort=bogus');
    expect(screen.getByRole('button').textContent).toBe('sort:name');
    expect(history.read().search).toBe('');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('sort:date');
    expect(history.read().search).toBe('?s0.list.sort=date');
  });
});

describe('<SplitRouter.Router>', () => {
  const login = defineRoute({ id: 'login', path: 'login' });
  const app = defineRoute({ id: 'app' });
  const home = defineRoute({ id: 'home', path: 'home' });
  const inbox = defineRoute({ id: 'inbox', path: 'inbox' });
  const defaultRoute = (): SplitRouteState => ({
    matches: [
      { id: 'app', params: {} },
      { id: 'home', params: {} },
    ],
  });

  function AppLayout() {
    const router = useSplitRouter();
    return (
      <For each={router.panes()}>
        {(pane) => (
          <section data-testid="pane">
            <Outlet pane={pane} />
          </section>
        )}
      </For>
    );
  }

  it('builds the route tree from its children and renders the first pane’s top-level route', async () => {
    let router: SplitRouter | undefined;
    function Layout() {
      router = useSplitRouter();
      return <AppLayout />;
    }
    const history = createMemoryHistory('/home/~/inbox');
    render(() => (
      <Router
        history={history}
        paneStore={createMemoryPaneStore()}
        policy={createTestPolicy().policy}
        defaultRoute={defaultRoute}
      >
        <Route definition={login} component={() => <p>login</p>} />
        <Route definition={app} component={Layout}>
          <Route definition={home} component={() => <p>home</p>} />
          <Route definition={inbox} component={() => <p>inbox</p>} />
        </Route>
      </Router>
    ));

    expect(screen.getAllByTestId('pane')).toHaveLength(2);
    expect(screen.getByText('inbox')).toBeTruthy();
    expect(home).not.toHaveProperty('component');

    await router!.navigatePane(router!.panes()[0]!, '/login');
    expect(screen.getByText('login')).toBeTruthy();
    expect(screen.queryAllByTestId('pane')).toHaveLength(0);
    expect(history.read().path).toBe('/login');
  });

  it('reads routes from arrays and drops false children', () => {
    const extra = [inbox].map((definition) => (
      <Route definition={definition} component={() => <p>inbox</p>} />
    ));
    render(() => (
      <Router
        history={createMemoryHistory('/inbox')}
        paneStore={createMemoryPaneStore()}
        policy={createTestPolicy().policy}
        defaultRoute={defaultRoute}
      >
        {false}
        <Route definition={app} component={AppLayout}>
          <Route definition={home} component={() => <p>home</p>} />
          {extra}
        </Route>
      </Router>
    ));
    expect(screen.getByText('inbox')).toBeTruthy();
  });

  it('passes the compiled routes to a history factory', () => {
    const seen: string[] = [];
    render(() => (
      <Router
        history={(routes) => {
          seen.push(...routes.byId.keys());
          return createMemoryHistory('/home');
        }}
        paneStore={createMemoryPaneStore()}
        policy={createTestPolicy().policy}
        defaultRoute={defaultRoute}
      >
        <Route definition={app} component={AppLayout}>
          <Route definition={home} component={() => <p>home</p>} />
        </Route>
      </Router>
    ));
    expect(seen).toEqual(['app', 'home']);
  });

  it('rejects definitions that already set children or a component', () => {
    const withComponent = defineRoute({
      id: 'bound',
      path: 'bound',
      component: () => null,
    });
    const options = {
      history: createMemoryHistory('/bound'),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createTestPolicy().policy,
      defaultRoute: (): SplitRouteState => ({
        matches: [{ id: 'bound', params: {} }],
      }),
    };
    expect(() =>
      render(() => (
        <Router {...options}>
          {/* @ts-expect-error definitions passed to Route carry no component */}
          <Route definition={withComponent} />
        </Router>
      ))
    ).toThrow(/must not set children or component/);
    expect(() =>
      render(() => (
        <Router {...options}>
          <p>not a route</p>
        </Router>
      ))
    ).toThrow(/must be <SplitRouter.Route> elements/);
  });
});
