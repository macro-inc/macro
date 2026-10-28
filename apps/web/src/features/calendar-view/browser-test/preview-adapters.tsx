import { Avatar } from '@ui';
import { createSignal } from 'solid-js';
import { EventAttendeesSection } from '../../calendar/components/EventDetails';
import type { CalendarEvent } from '../../calendar/types';

export { sanitizeCalendarDescription } from '../../calendar/utils/calendar-description-sanitizer';
export const parseMacroAppLink = () => undefined;
export const recipientEntityMapper = () => () => undefined;

// Sample services for the event details overlays. The popover, drawer, and
// join-requests section render their real UI; the requests arrive when the
// test calls `window.calendarPreview.deliverJoinRequests()`.
export type CalendarJoinRequest = {
  id: string;
  eventId: string;
  requesterId: string;
  requesterEmail: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
};

const sampleRequest: CalendarJoinRequest = {
  id: 'request-1',
  eventId: 'event-1',
  requesterId: 'macro|member@example.com',
  requesterEmail: 'member@example.com',
  status: 'pending',
  createdAt: '2026-10-22T18:00:00Z',
};

const [joinRequests, setJoinRequests] = createSignal<
  CalendarJoinRequest[] | undefined
>(
  new URLSearchParams(location.search).get('requests') === 'loaded'
    ? [sampleRequest]
    : undefined
);
declare global {
  interface Window {
    calendarPreview: { deliverJoinRequests: () => void };
  }
}
window.calendarPreview = {
  deliverJoinRequests: () => setJoinRequests([sampleRequest]),
};

function announce(message: string) {
  document.dispatchEvent(
    new CustomEvent('calendar-preview-message', { detail: message })
  );
}

export function useCalendarJoinRequestsQuery(
  _eventId: () => string,
  options: () => { enabled: boolean }
) {
  return {
    get isPending() {
      return !options().enabled || joinRequests() === undefined;
    },
    get data() {
      return joinRequests();
    },
  };
}
export function useRespondToCalendarJoinRequestMutation(callbacks?: {
  onSuccess?: (answered: CalendarJoinRequest) => void;
}) {
  return {
    isPending: false,
    mutate: (args: {
      request: CalendarJoinRequest;
      decision: 'accept' | 'decline';
    }) => {
      setJoinRequests((current) =>
        current?.filter((request) => request.id !== args.request.id)
      );
      callbacks?.onSuccess?.({
        ...args.request,
        status: args.decision === 'accept' ? 'accepted' : 'declined',
      });
    },
  };
}
export const isGuestInviteRefused = () => false;

export const useVisibleCalendarsQuery = () => ({ isSuccess: true, data: [] });
export const useDeleteCalendarEventMutation = () => ({
  isPending: false,
  mutate: () => announce('Delete event · Preview only'),
});
export const useSplitLayout = () => ({ openWithSplit: () => {} });
export const useOpenEventComposer = () => () =>
  announce('Edit event · Preview only');
export const useForwardEventEmail = () => () =>
  announce('Forward event · Preview only');
export const createGuestInviteController = () => ({
  editorOpen: () => false,
  forwardEditorOpen: () => false,
});
export const useCalendarGuestInvitesFlag = () => () => false;
export const useCalendarInvitationForwardFlag = () => () => false;
export const useCalendarMeetingNotesFlag = () => () => false;
export const CalendarMeetingNotes = () => null;
export const EventGuests = (props: { event: CalendarEvent }) => (
  <EventAttendeesSection attendees={props.event.attendees} />
);
export const TeamEventDetails = () => null;
export const OutlookRsvpAction = () => null;
export const copyCalendarEventMention = () =>
  announce('Copy event · Preview only');
export const downloadCalendarEventIcs = () =>
  announce('Download event · Preview only');
export const openDocument = () => announce('Open document · Preview only');
export const toast = { success: announce, failure: announce };

export const createCalendarRsvpController = () => ({
  pending: () => false,
  error: () => undefined,
  scopeOpen: () => false,
  scope: () => 'this_event',
  setScope: () => {},
  closeScope: () => {},
  confirmScope: () => {},
  respond: () => announce('RSVP · Preview only'),
});

const names: Record<string, string> = {
  'macro|member@example.com': 'Morgan Member',
  'alex@example.com': 'Alex Morgan',
  'sam@example.com': 'Sam Lee',
  'you@example.com': 'You',
};
export const emailToMacroId = (email: string) => email;
export const getDisplayName = (id?: string) => names[id ?? ''] ?? '';
export const getInitialsFromName = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('');
export function UserIcon(props: { id?: string; email?: string; size?: 'md' }) {
  return (
    <Avatar size={props.size ?? 'md'}>
      <Avatar.Fallback>
        {getInitialsFromName(getDisplayName(props.id ?? props.email))}
      </Avatar.Fallback>
    </Avatar>
  );
}
export const OwnerLabel = (props: { ownerId: string }) => (
  <span class="text-ink">{getDisplayName(props.ownerId)}</span>
);
