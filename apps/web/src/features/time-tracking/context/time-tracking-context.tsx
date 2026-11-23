import type { Client } from '@urql/core';
import {
  type Accessor,
  createContext,
  type JSX,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { TimeLoggedHost } from '../queries/time-entries';

/** What time tracking needs from the app: its GraphQL client, cache and viewer. */
export type TimeTrackingCapabilities = {
  client: Accessor<Client>;
  /** Absent without the normalized cache: writes then predict nothing. */
  cacheHost: Accessor<TimeLoggedHost | undefined>;
  /** The signed-in person, whose entries they may change. */
  viewerId: Accessor<string | undefined>;
};

const TimeTrackingContext = createContext<TimeTrackingCapabilities>();

export function TimeTrackingContextProvider(
  props: ParentProps<{ value: TimeTrackingCapabilities }>
): JSX.Element {
  return (
    <TimeTrackingContext.Provider value={props.value}>
      {props.children}
    </TimeTrackingContext.Provider>
  );
}

export function useTimeTracking(): TimeTrackingCapabilities {
  const capabilities = useContext(TimeTrackingContext);
  if (!capabilities) {
    throw new Error('Time tracking used outside TimeTrackingContextProvider');
  }
  return capabilities;
}
