import { useUserId } from '@core/context/user';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { JSX, ParentProps } from 'solid-js';
import { TimeTrackingContextProvider } from './context/time-tracking-context';

/** Supplies time tracking with the app's GraphQL client, cache and viewer. */
export function TimeTrackingProvider(props: ParentProps): JSX.Element {
  const userId = useUserId();
  return (
    <TimeTrackingContextProvider
      value={{
        client: getGraphqlSoupClient,
        cacheHost: getGraphqlCacheHost,
        viewerId: () => userId() ?? undefined,
      }}
    >
      {props.children}
    </TimeTrackingContextProvider>
  );
}
