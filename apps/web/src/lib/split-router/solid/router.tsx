import { type JSX, onCleanup, untrack } from 'solid-js';
import { createSplitRouter } from '../router/create-router';
import type { SplitRouterOptions } from '../router/types';
import type { SplitRoutes } from '../routes/types';
import { SplitRouterProvider } from './context';
import { Outlet } from './outlet';
import { routeDefinitions } from './route';

export type RouterProps = Omit<SplitRouterOptions, 'routes'> &
  Omit<SplitRoutes, 'definitions'> & {
    /** `<SplitRouter.Route>` elements; they are read once, when the router is created. */
    children: JSX.Element;
  };

/**
 * Creates a router from its `<SplitRouter.Route>` children and renders the
 * first pane's top-level route. To create the router yourself, pass it to
 * `<SplitRouter.Root>` instead.
 */
export function Router(props: RouterProps): JSX.Element {
  const router = untrack(() =>
    createSplitRouter({
      routes: {
        definitions: routeDefinitions(props.children),
        globalSearch: props.globalSearch,
        defaultRoute: props.defaultRoute,
      },
      history: props.history,
      paneStore: props.paneStore,
      policy: props.policy,
      middleware: props.middleware,
      preloadBudgetMs: props.preloadBudgetMs,
      createPaneId: props.createPaneId,
    })
  );
  onCleanup(router.dispose);

  return (
    <SplitRouterProvider router={router}>
      <Outlet />
    </SplitRouterProvider>
  );
}
