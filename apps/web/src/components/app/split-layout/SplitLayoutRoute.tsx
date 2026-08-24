import { experimentalAppLayoutEnabled } from '@app/features/experimental-app-layout/state';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { WithRequired } from '@core/util/withRequired';
import {
  type RouteDefinition,
  type RouteSectionProps,
  useParams,
} from '@solidjs/router';
import { SplitLayoutContainer } from './SplitLayout';
import {
  parseChannelsWorkspaceRoute,
  serializeChannelsWorkspacePath,
} from './channelsWorkspaceRoute';

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

function ChannelsLayoutRoute() {
  const params = useParams<{ channelsPath?: string }>();
  const messagesWorkspaceEnabled = () =>
    experimentalAppLayoutEnabled() && !isTouchDevice();
  const route = () => parseChannelsWorkspaceRoute(params.channelsPath);
  const pairs = () => {
    const { selectedChannelId, splitSegments } = route();
    if (messagesWorkspaceEnabled()) {
      return ['component', 'channels', ...splitSegments];
    }
    return selectedChannelId
      ? ['channel', selectedChannelId, ...splitSegments]
      : ['component', 'channels', ...splitSegments];
  };

  return (
    <SplitLayoutContainer
      pairs={pairs()}
      setManager={setGlobalSplitManager}
      serializePath={
        messagesWorkspaceEnabled()
          ? (segments) =>
              serializeChannelsWorkspacePath(
                segments,
                route().selectedChannelId
              )
          : undefined
      }
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

/** Messages workspace route; the optional tail is the active channel id. */
export const CHANNELS_LAYOUT_ROUTE: WithRequired<
  RouteDefinition,
  'component'
> = {
  path: '/channels/*channelsPath',
  component: ChannelsLayoutRoute,
};

/** Standalone chat workspace route; the optional tail is the active chat id. */
export const CHAT_LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/chat/*id',
  component: ChatLayoutRoute,
};

export const LAYOUT_ROUTE: WithRequired<RouteDefinition, 'component'> = {
  path: '/*splits',
  component: LayoutRoute,
};
