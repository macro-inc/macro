import type { WithRequired } from '@core/util/withRequired';
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router';
import { setGlobalSplitManager } from '../../signal/splitLayout';
import { SplitLayoutContainer } from './SplitLayout';

type LayoutPath = {
  params: {
    splits: string | undefined;
  };
};

function LayoutRoute(props: RouteSectionProps & LayoutPath) {
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
