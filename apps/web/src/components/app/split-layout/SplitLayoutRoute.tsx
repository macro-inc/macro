import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type { WithRequired } from '@core/util/withRequired';
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router';
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

function ChatLayoutRoute() {
  return (
    <SplitLayoutContainer
      pairs={['component', 'chat-workspace']}
      setManager={setGlobalSplitManager}
    />
  );
}

/** Standalone chat workspace route; the optional tail is the active chat id. */
export const CHAT_LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/chat/*id',
  component: ChatLayoutRoute,
};

export const LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/*splits',
  component: LayoutRoute,
};
