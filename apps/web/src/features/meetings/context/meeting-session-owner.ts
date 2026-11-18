import { createContext, useContext } from 'solid-js';
import type { createMeetingSessionOwner } from '../primitives/meeting-session-owner';

export const MeetingSessionOwnerContext =
  createContext<ReturnType<typeof createMeetingSessionOwner>>();

export function useMeetingSessionOwnerOptional() {
  return useContext(MeetingSessionOwnerContext);
}

export function useMeetingSessionOwner() {
  const owner = useMeetingSessionOwnerOptional();
  if (!owner)
    throw new Error('Meeting sessions require MeetingSessionProvider');
  return owner;
}
