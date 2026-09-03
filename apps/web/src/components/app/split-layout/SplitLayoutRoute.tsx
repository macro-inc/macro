import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type { WithRequired } from '@core/util/withRequired';
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router';
import { lazy, Suspense } from 'solid-js';

const SplitLayoutContainer = lazy(() =>
  import('./SplitLayout').then((module) => ({
    default: module.SplitLayoutContainer,
  }))
);

function LayoutRoute(props: RouteSectionProps) {
  return (
    <Suspense>
      <SplitLayoutContainer
        pairs={props.params.splits?.split('/') ?? []}
        setManager={setGlobalSplitManager}
      />
    </Suspense>
  );
}

export const LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/*splits',
  component: LayoutRoute,
};
