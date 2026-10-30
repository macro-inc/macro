import { Avatar } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  FORWARD_INVITATION_INSTEAD,
  GUEST_INVITES_RESTRICTED,
} from '../../calendar/utils/event-guest-editing';

export { sanitizeCalendarDescription } from '../../calendar/utils/calendar-description-sanitizer';
export const parseMacroAppLink = () => undefined;
export const recipientEntityMapper =
  <K extends string>(kind: K) =>
  <T extends { id: string }>(data: T) => ({ kind, data, id: data.id });
export const idToEmail = (id: string) => id.replace(/^macro\|/, '');

// Sample services for the event details overlays. The popover, drawer,
// join-requests section and guest editors render their real UI; the requests
// arrive when the test calls `window.calendarPreview.deliverJoinRequests()`,
// and with `?contacts=late` the guest picker's contacts arrive on
// `window.calendarPreview.deliverContacts()`.
const params = new URLSearchParams(location.search);
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
>(params.get('requests') === 'loaded' ? [sampleRequest] : undefined);
const sampleContacts = [
  'Avery Park',
  'Blake Chen',
  'Casey Diaz',
  'Devon Price',
  'Emery Stone',
  'Finley Ross',
  'Harper Quinn',
  'Jordan Wells',
].map((name) => {
  const email = `${name.split(' ')[0]?.toLowerCase()}@example.com`;
  return { id: `macro|${email}`, email, name };
});
const [contacts, setContacts] = createSignal(
  params.get('contacts') === 'late' ? [] : sampleContacts
);

declare global {
  interface Window {
    calendarPreview: {
      deliverJoinRequests: () => void;
      deliverContacts: () => void;
    };
  }
}
window.calendarPreview = {
  deliverJoinRequests: () => setJoinRequests([sampleRequest]),
  deliverContacts: () => setContacts(sampleContacts),
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

// `?guests=add` offers Add guests and `?guests=forward` offers Forward
// invitation; sending closes the editor and announces the recipients.
const guestAction = params.get('guests');
export function createGuestInviteController() {
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [forwardEditorOpen, setForwardEditorOpen] = createSignal(false);
  return {
    editorOpen,
    setEditorOpen,
    forwardEditorOpen,
    setForwardEditorOpen,
    canInvite: () => guestAction === 'add',
    canForward: () => guestAction === 'forward',
    restrictedReason: () =>
      guestAction === 'forward'
        ? `${GUEST_INVITES_RESTRICTED} ${FORWARD_INVITATION_INSTEAD}`
        : undefined,
    send: (invitation: { guests: { email: string }[] }) => {
      setEditorOpen(false);
      announce(
        `Invited ${invitation.guests.map((guest) => guest.email).join(', ')}`
      );
    },
    forward: (forward: { recipients: { email: string }[] }) => {
      setForwardEditorOpen(false);
      announce(
        `Forwarded to ${forward.recipients.map((guest) => guest.email).join(', ')}`
      );
    },
  };
}
export const useCalendarGuestInvitesFlag = () => () => false;
export const useCalendarInvitationForwardFlag = () => () => false;
export const useCalendarMeetingNotesFlag = () => () => false;
export const CalendarMeetingNotes = () => null;
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
export const useContacts = () => contacts;
export const useOpenEventEmail = () => () =>
  announce('Email guests · Preview only');
export const copyGuestEmails = () =>
  announce('Copy guest emails · Preview only');

/**
 * The guest picker's search field and suggestion list, laid out like the
 * real selector (a field over a list capped at 192px) so the editor around
 * it sizes the same, over the sample contacts instead of search.
 */
export function PropertyEntitySelector(props: {
  config: {
    placeholder?: string;
    users?: () => { id: string; email: string; name?: string }[];
    excludedIds?: () => ReadonlySet<string>;
  };
  selectedOptions: () => Set<string>;
  setSelectedOptions: (options: Set<string>) => void;
}) {
  const [query, setQuery] = createSignal('');
  const matches = createMemo(() =>
    (props.config.users?.() ?? []).filter(
      (user) =>
        !props.config.excludedIds?.().has(user.id) &&
        `${user.name ?? ''} ${user.email}`
          .toLowerCase()
          .includes(query().toLowerCase())
    )
  );
  return (
    <div>
      <div class="flex w-full items-center gap-2 border-b border-edge-muted px-2 py-2">
        <input
          class="w-full caret-accent"
          type="text"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={props.config.placeholder}
        />
      </div>
      <Show when={matches().length > 0}>
        <div class="p-1.5">
          <div
            role="listbox"
            aria-label="Suggestions"
            class="max-h-48 overflow-y-auto"
          >
            <For each={matches()}>
              {(user) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  class="flex w-full min-w-0 items-center rounded-lg p-1.5 px-2 text-left text-ink"
                  onClick={() =>
                    props.setSelectedOptions(
                      new Set([...props.selectedOptions(), user.id])
                    )
                  }
                >
                  <span class="truncate">{user.name ?? user.email}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
export const emailToMacroId = (email: string) => email;
export const getDisplayName = (id?: string) =>
  names[id ?? ''] ??
  sampleContacts.find((contact) => contact.id === id || contact.email === id)
    ?.name ??
  '';
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
