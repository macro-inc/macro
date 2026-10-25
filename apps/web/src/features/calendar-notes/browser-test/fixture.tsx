import '@fontsource-variable/inter';
import '../../../index.css';
import { fireAndForget } from '@core/util/fireAndForget';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import { Button, ImperativeDialogHost } from '@ui';
import { ok } from 'neverthrow';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { CalendarEvent } from '../../calendar/types';
import { SelectedEventDetails } from '../../calendar-view/components/SelectedEventDetails';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type { DocumentNoteLink } from '../core/types';
import { createFakeNotesSource } from '../tests/fake-source';
import { DocumentNotesView } from '../views/document-notes';
import { PreviewNotesProvider } from './preview-adapters';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(
  params.get('theme') !== 'dark'
);
const theme = params.get('theme') === 'dark' ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const calendar = { id: 'calendar-1', name: 'Calendar', color: '#609fe2' };
const sampleEvent: CalendarEvent = {
  id: 'weekly-sync',
  eventId: 'event-1',
  occurrenceKey: '2026-10-23T14:00:00Z',
  title: 'Weekly product sync',
  start: '2026-10-23T14:00:00Z',
  end: '2026-10-23T14:30:00Z',
  allDay: false,
  isCancelled: false,
  isReadOnly: false,
  description: 'Review progress, decisions, and next steps.',
  recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
  guestPolicy: {
    canModify: false,
    canInviteOthers: true,
    canSeeOtherGuests: true,
  },
  viewerCan: {
    editDetails: false,
    inviteGuests: true,
    removeGuests: false,
    setGuestPolicy: false,
    rsvp: true,
    organize: false,
  },
  attendees: [
    {
      email: 'alex@example.com',
      isOptional: false,
      isOrganizer: true,
      isSelf: false,
      responseStatus: 'accepted',
    },
    {
      email: 'sam@example.com',
      isOptional: false,
      isOrganizer: false,
      isSelf: false,
      responseStatus: 'accepted',
    },
    {
      email: 'you@example.com',
      isOptional: false,
      isOrganizer: false,
      isSelf: true,
      responseStatus: 'accepted',
    },
  ],
  organizerEmail: 'alex@example.com',
  sourceCalendarIds: [calendar.id],
  calendarId: calendar.id,
  calendar,
  visibleCalendars: [calendar],
};

function Fixture() {
  const [links, setLinks] = createSignal<DocumentNoteLink[]>([
    {
      eventId: 'unavailable',
      occurrenceKey: '2026-10-23T14:00:00Z',
      eventTitle: 'Unavailable meeting',
      team: { id: 'macro', name: 'Macro' },
    },
  ]);
  if (params.has('document'))
    return (
      <main class="min-h-dvh bg-page px-3 py-10 text-ink">
        <div class="mx-auto max-w-[480px]">
          <h1 class="mb-4 text-lg font-semibold">
            Share: Weekly product notes
          </h1>
          <DocumentNotesView
            source={{
              links: () => ({ data: links(), pending: false }),
              retry: async () => {},
              unlink: async () => {
                setLinks([]);
                return ok(undefined);
              },
            }}
          />
          <p class="mt-4 text-sm">Your document is saved.</p>
        </div>
      </main>
    );
  const fake = createFakeNotesSource({
    fail: params.has('fail'),
  });
  const teamProjectionKind = params.get('team');
  const [event, setEvent] = createSignal<CalendarEvent>({
    ...sampleEvent,
    teamProjection:
      teamProjectionKind === 'details' || teamProjectionKind === 'busy'
        ? { kind: teamProjectionKind, ownerId: 'macro|alex@example.com' }
        : undefined,
    guestPolicy: {
      ...sampleEvent.guestPolicy,
      canSeeOtherGuests: !params.has('hidden'),
    },
  });
  const [selected, setSelected] = createSignal(true);
  const [boundary, setBoundary] = createSignal<HTMLDivElement>();
  const [anchor, setAnchor] = createSignal<HTMLButtonElement>();
  const [message, setMessage] = createSignal('');
  const onMessage = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string')
      setMessage(event.detail);
  };
  const onRsvp = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const response = event.detail;
    if (
      response !== 'accepted' &&
      response !== 'tentative' &&
      response !== 'declined'
    )
      return;
    setEvent((current) => ({
      ...current,
      attendees: current.attendees.map((attendee) =>
        attendee.isSelf ? { ...attendee, responseStatus: response } : attendee
      ),
    }));
  };
  const onRemoteUnlink = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string') {
      fireAndForget(
        fake.source.unlink(event.detail),
        'calendar.preview.unlink'
      );
    }
  };
  document.addEventListener('calendar-preview-message', onMessage);
  document.addEventListener('calendar-preview-rsvp', onRsvp);
  document.addEventListener('calendar-preview-unlink', onRemoteUnlink);
  onCleanup(() => {
    document.removeEventListener('calendar-preview-message', onMessage);
    document.removeEventListener('calendar-preview-rsvp', onRsvp);
    document.removeEventListener('calendar-preview-unlink', onRemoteUnlink);
  });
  return (
    <PreviewNotesProvider source={fake.source}>
      <main
        ref={setBoundary}
        class="relative min-h-dvh bg-page p-4 text-ink sm:p-8"
      >
        <div class="flex items-center gap-2 text-sm text-ink-muted">
          <CalendarIcon class="size-4" /> Friday, October 23
        </div>
        <Button
          ref={setAnchor}
          variant="outline"
          size="md"
          class="mt-5"
          onClick={() => setSelected(true)}
        >
          Weekly product sync
        </Button>
        <Show when={message()}>
          <p
            role="status"
            aria-label="Preview action"
            class="mt-4 text-sm text-ink-muted"
          >
            {message()}
          </p>
        </Show>
        <Show when={boundary()}>
          {(element) => (
            <SelectedEventDetails
              boundary={element()}
              anchor={anchor}
              event={() => (selected() ? event() : undefined)}
              timeFormat={() => '12-hour'}
              onClose={() => setSelected(false)}
            />
          )}
        </Show>
        <ImperativeDialogHost />
      </main>
    </PreviewNotesProvider>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
