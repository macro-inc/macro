import type { ParentProps } from 'solid-js';
import { MeetingSessionLifecycleContext } from './context/meeting-session-lifecycle';
import { createMeetingSessionLifecycle } from './primitives/meeting-session-lifecycle';

/** Mounted above the router so leaving a meeting cannot discard pending cleanup. */
export function MeetingSessionProvider(props: ParentProps) {
  const lifecycle = createMeetingSessionLifecycle();
  return (
    <MeetingSessionLifecycleContext.Provider value={lifecycle}>
      {props.children}
    </MeetingSessionLifecycleContext.Provider>
  );
}
