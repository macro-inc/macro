import { createContext, useContext } from 'solid-js';
import type { createMeetingSessionOwner } from '../primitives/meeting-session-owner';

export const MeetingSessionOwnerContext =
  createContext<ReturnType<typeof createMeetingSessionOwner>>();

export function useMeetingSessionOwner() {
  const owner = useContext(MeetingSessionOwnerContext);
  if (!owner)
    throw new Error('Meeting sessions require MeetingSessionProvider');
  return owner;
}
