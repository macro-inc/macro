import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type { WithRequired } from '@core/util/withRequired';
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router';
import { SplitLayoutContainer } from './SplitLayout';

function LayoutRoute(props: RouteSectionProps) {
  return (
    <SplitLayoutContainer
      pairs={props.params.splits?.split('/') ?? []}
      setManager={setGlobalSplitManager}
    />
  );
}

export const LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/*splits',
  component: LayoutRoute,
};
