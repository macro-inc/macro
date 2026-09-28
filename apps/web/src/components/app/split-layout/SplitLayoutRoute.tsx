import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { enableNewAppViews } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { WithRequired } from '@core/util/withRequired';
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router';
import { SplitLayoutContainer } from './SplitLayout';
import { createAppSplitRouterMiddleware } from './split-router/app-middleware';
import { appSplitRoutes } from './split-router/app-routes';

function LayoutRoute(props: RouteSectionProps) {
  const newAppViews = useFeatureFlag(enableNewAppViews);
  const middleware = createAppSplitRouterMiddleware({
    newAppViews,
    isTouchDevice,
  });

  return (
    <SplitLayoutContainer
      pairs={props.params.splits?.split('/') ?? []}
      routes={appSplitRoutes}
      middleware={middleware}
      setManager={setGlobalSplitManager}
    />
  );
}

export const LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/*splits',
  component: LayoutRoute,
};
