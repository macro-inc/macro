import '@fontsource-variable/inter';
import '../../../index.css';
import { Button, ImperativeDialogHost } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { CalendarEvent } from '../../calendar/types';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { SelectedEventDetails } from '../components/SelectedEventDetails';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';

const params = new URLSearchParams(location.search);
const calendar = { id: 'calendar-1', name: 'Calendar', color: '#609fe2' };
const sampleEvent: CalendarEvent = {
  id: 'planning-review',
  eventId: 'event-1',
  occurrenceKey: '2026-10-29T19:00:00Z',
  title: 'Planning review',
  start: '2026-10-29T19:00:00Z',
  end: '2026-10-29T20:00:00Z',
  allDay: false,
  isCancelled: false,
  isReadOnly: false,
  description: 'Walk through the roadmap and agree on owners.',
  recurrenceLines: [],
  guestPolicy: {
    canModify: false,
    canInviteOthers: true,
    canSeeOtherGuests: true,
  },
  viewerCan: {
    editDetails: true,
    inviteGuests: true,
    removeGuests: true,
    setGuestPolicy: true,
    rsvp: true,
    organize: true,
  },
  attendees: [
    {
      email: 'you@example.com',
      isOptional: false,
      isOrganizer: true,
      isSelf: true,
      responseStatus: 'accepted',
    },
    {
      email: 'alex@example.com',
      isOptional: false,
      isOrganizer: false,
      isSelf: false,
      responseStatus: 'accepted',
    },
    {
      email: 'sam@example.com',
      isOptional: false,
      isOrganizer: false,
      isSelf: false,
      responseStatus: 'needs_action',
    },
  ],
  organizerEmail: 'you@example.com',
  sourceCalendarIds: [calendar.id],
  calendarId: calendar.id,
  calendar,
  visibleCalendars: [calendar],
};

/** An event the viewer organizes, its chip placed `?top=` px down the page. */
function Fixture() {
  const [selected, setSelected] = createSignal(false);
  const [boundary, setBoundary] = createSignal<HTMLDivElement>();
  const [anchor, setAnchor] = createSignal<HTMLButtonElement>();
  const [message, setMessage] = createSignal('');
  const onMessage = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string')
      setMessage(event.detail);
  };
  document.addEventListener('calendar-preview-message', onMessage);
  onCleanup(() =>
    document.removeEventListener('calendar-preview-message', onMessage)
  );
  return (
    <main
      ref={setBoundary}
      class="relative h-dvh overflow-hidden bg-page p-4 text-ink"
    >
      <Show when={message()}>
        <p
          role="status"
          aria-label="Preview action"
          class="text-sm text-ink-muted"
        >
          {message()}
        </p>
      </Show>
      <div
        class="absolute left-[30%] w-40"
        style={{ top: `${Number(params.get('top') ?? 40)}px` }}
      >
        <Button
          ref={setAnchor}
          variant="secondary"
          size="md"
          fullWidth
          onClick={() => setSelected(true)}
        >
          Planning review
        </Button>
      </div>
      <Show when={boundary()}>
        {(element) => (
          <SelectedEventDetails
            boundary={element()}
            anchor={anchor}
            event={() => (selected() ? sampleEvent : undefined)}
            timeFormat={() => '12-hour'}
            onClose={() => setSelected(false)}
          />
        )}
      </Show>
      <ImperativeDialogHost />
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
