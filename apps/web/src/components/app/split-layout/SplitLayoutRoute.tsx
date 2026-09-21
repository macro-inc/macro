import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type { WithRequired } from '@core/util/withRequired';
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router';
import { SplitLayoutContainer } from './SplitLayout';
import { appSplitRouterMiddleware } from './split-router/app-middleware';
import { appSplitRoutes } from './split-router/app-routes';

function LayoutRoute(props: RouteSectionProps) {
  return (
    <SplitLayoutContainer
      pairs={props.params.splits?.split('/') ?? []}
      routes={appSplitRoutes}
      middleware={appSplitRouterMiddleware}
      setManager={setGlobalSplitManager}
    />
  );
}

export const LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/*splits',
  component: LayoutRoute,
};
