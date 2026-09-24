import { type Accessor, createContext, useContext } from 'solid-js';
import type { IncomingMeetingInvitation } from '../core/meeting-invitations';

type IncomingMeetingInvitations = {
  invitations: Accessor<IncomingMeetingInvitation[]>;
  answer: (invitation: IncomingMeetingInvitation) => void;
  dismiss: (invitation: IncomingMeetingInvitation) => void;
};

export const IncomingMeetingInvitationsContext =
  createContext<IncomingMeetingInvitations>();

export function useIncomingMeetingInvitations() {
  const context = useContext(IncomingMeetingInvitationsContext);
  if (!context)
    throw new Error('Incoming meeting invitations require their provider');
  return context;
}
