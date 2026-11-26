import { useUserId } from '@core/context/user';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { JSX, ParentProps } from 'solid-js';
import {
  type TimeTrackingCapabilities,
  TimeTrackingContextProvider,
} from './context/time-tracking-context';
import { useRunningTimer } from './running-timer-root';

/** Time tracking's app capabilities: GraphQL client, cache, viewer and timer. */
export function useTimeTrackingCapabilities(): TimeTrackingCapabilities {
  const userId = useUserId();
  return {
    client: getGraphqlSoupClient,
    cacheHost: getGraphqlCacheHost,
    viewerId: () => userId() ?? undefined,
    runningTimer: useRunningTimer(),
  };
}

/** Supplies time tracking with the app's capabilities. */
export function TimeTrackingProvider(props: ParentProps): JSX.Element {
  return (
    <TimeTrackingContextProvider value={useTimeTrackingCapabilities()}>
      {props.children}
    </TimeTrackingContextProvider>
  );
}
