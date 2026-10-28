import { createContext, useContext } from 'solid-js';

export type MeetingSessionLifecycle = {
  /** Reserve work before starting it; later owners wait until it completes. */
  begin: () => { previous: Promise<void>; complete: () => void };
};

export const MeetingSessionLifecycleContext =
  createContext<MeetingSessionLifecycle>();

export function useMeetingSessionLifecycle() {
  const lifecycle = useContext(MeetingSessionLifecycleContext);
  if (!lifecycle)
    throw new Error('Meeting sessions require MeetingSessionProvider');
  return lifecycle;
}
