import { Avatar } from '@ui';
import { createContext, type ParentProps, useContext } from 'solid-js';
import { EventAttendeesSection } from '../../calendar/components/EventDetails';
import type { CalendarEvent } from '../../calendar/types';
import type { NotesSource } from '../context/notes-source';
import { MeetingNotesView } from '../views/meeting-notes';

export { sanitizeCalendarDescription } from '../../calendar/utils/calendar-description-sanitizer';
export const parseMacroAppLink = () => undefined;
export const recipientEntityMapper = () => () => undefined;

// Sample sources, identities, and placeholders for unrelated calendar actions.
// Event details, its popover/drawer, and the notes controls render their real UI.
const NotesContext = createContext<NotesSource>();
export function PreviewNotesProvider(
  props: ParentProps<{ source: NotesSource }>
) {
  return (
    <NotesContext.Provider value={props.source}>
      {props.children}
    </NotesContext.Provider>
  );
}

function announce(message: string) {
  document.dispatchEvent(
    new CustomEvent('calendar-preview-message', { detail: message })
  );
}

export function CalendarMeetingNotes(props: {
  event: CalendarEvent;
  onOpenDocument: (id: string) => void;
  onDialogChange: (open: boolean) => void;
}) {
  const source = useContext(NotesContext);
  if (!source) throw new Error('The calendar preview needs a notes source');
  return (
    <MeetingNotesView
      source={source}
      eventTitle={props.event.title}
      recurring={props.event.recurrenceLines.length > 0}
      guestListHidden={!props.event.guestPolicy.canSeeOtherGuests}
      onOpen={(note) => {
        announce(`Opened ${note.name}`);
        props.onOpenDocument(note.documentId);
      }}
      onDialogChange={props.onDialogChange}
    />
  );
}

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
export const createGuestInviteController = () => ({ editorOpen: () => false });
export const useCalendarGuestInvitesFlag = () => () => false;
export const useCalendarMeetingNotesFlag = () => () =>
  new URLSearchParams(location.search).get('notes') !== 'off';
export const EventGuests = (props: { event: CalendarEvent }) => (
  <EventAttendeesSection attendees={props.event.attendees} />
);
export const EventJoinRequests = () => null;
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
  respond: (response: string) =>
    document.dispatchEvent(
      new CustomEvent('calendar-preview-rsvp', { detail: response })
    ),
});

const names: Record<string, string> = {
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
