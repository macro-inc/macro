import type { ParentProps } from 'solid-js';
import { MeetingSessionLifecycleContext } from './context/meeting-session-lifecycle';
import { MeetingSessionOwnerContext } from './context/meeting-session-owner';
import { createMeetingSessionLifecycle } from './primitives/meeting-session-lifecycle';
import { createMeetingSessionOwner } from './primitives/meeting-session-owner';

/** Mounted above the router so leaving a meeting cannot discard pending cleanup. */
export function MeetingSessionProvider(props: ParentProps) {
  const lifecycle = createMeetingSessionLifecycle();
  const owner = createMeetingSessionOwner();
  return (
    <MeetingSessionLifecycleContext.Provider value={lifecycle}>
      <MeetingSessionOwnerContext.Provider value={owner}>
        {props.children}
      </MeetingSessionOwnerContext.Provider>
    </MeetingSessionLifecycleContext.Provider>
  );
}
