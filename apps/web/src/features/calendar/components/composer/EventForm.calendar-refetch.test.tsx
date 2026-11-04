/**
 * @vitest-environment jsdom
 */

import type { VisibleCalendar } from '@queries/calendar/calendars';
import { calendarKeys } from '@queries/calendar/keys';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEventEditor } from '../../hooks/use-event-editor';
import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import { EventForm } from './EventForm';

const mocks = vi.hoisted(() => ({ listCalendars: vi.fn() }));

vi.mock('@service-email/client', () => ({
  emailClient: { listCalendars: mocks.listCalendars },
}));
vi.mock('@queries/calendar/graphql/flag', () => ({
  useGraphqlCalendarHost: () => () => undefined,
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  recipientEntityMapper: () => (value: unknown) => value,
}));
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => () => undefined,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/MarkdownTextarea',
  () => ({ MarkdownTextarea: () => null })
);
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => document.createElement('input'),
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const GOOGLE_CAPABILITIES = {
  conferenceProvider: 'google_meet',
  removeConference: true,
  autoDecline: true,
  emailReminders: true,
  customRecurrence: true,
  resetRsvp: true,
  guestPolicy: true,
} as const;

/** The list as the server sends it: new objects on every response. */
function serverCalendars(): VisibleCalendar[] {
  const google = (id: string, name: string, isPrimary: boolean) => ({
    provider: 'google' as const,
    capabilities: { ...GOOGLE_CAPABILITIES },
    id,
    emailLinkId: 'gmail-link',
    emailAddress: 'ada@example.com',
    name,
    color: '#4285f4',
    isPrimary,
    isWritable: true,
    isSubscription: false,
    defaultReminders: [{ method: 'popup' as const, minutes: 10 }],
  });
  return [
    google('google-primary', 'ada@example.com', true),
    google('google-shared', 'team@example.com', false),
    google('google-vacation', 'Vacation', false),
    {
      provider: 'outlook',
      capabilities: {
        conferenceProvider: 'microsoft_teams',
        removeConference: false,
        autoDecline: true,
        emailReminders: false,
        customRecurrence: false,
        resetRsvp: false,
        guestPolicy: false,
      },
      id: 'outlook-primary',
      emailLinkId: 'outlook-link',
      emailAddress: 'ada@example.onmicrosoft.com',
      name: 'Calendar',
      color: '#0078d4',
      isPrimary: true,
      isWritable: true,
      isSubscription: false,
      defaultReminders: [],
    },
  ];
}

function NewEventForm() {
  const editor = useEventEditor({
    event: () => undefined,
    onSaved: vi.fn(),
    macroCallsEnabled: () => true,
  });
  const controller = createCalendarEventFormController({
    initialValue: {
      title: '',
      allDay: false,
      start: '2030-01-01T12:00',
      end: '2030-01-01T13:00',
      recurrenceLines: [],
      guests: '',
      location: '',
      description: '',
      conference: 'macro',
    },
    calendarOptions: editor.calendarOptions,
    guestOptions: editor.guestOptions,
  });
  return (
    <EventForm
      controller={controller}
      macroCallsEnabled
      pending={false}
      onCancel={vi.fn()}
      onSubmit={editor.save}
    />
  );
}

let client: QueryClient;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
  mocks.listCalendars.mockImplementation(async () =>
    ok({ calendars: serverCalendars() })
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

it('chooses the Outlook calendar from the keyboard after the calendar list refetches', async () => {
  const user = userEvent.setup();
  render(() => (
    <QueryClientProvider client={client}>
      <NewEventForm />
    </QueryClientProvider>
  ));
  const trigger = screen.getByLabelText('Calendar');
  await waitFor(() => expect(trigger.textContent).toContain('ada@example.com'));

  await user.click(trigger);
  await screen.findByRole('listbox');
  await client.refetchQueries({
    queryKey: calendarKeys.visibleCalendars.queryKey,
  });
  expect(mocks.listCalendars).toHaveBeenCalledTimes(2);

  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

  expect(trigger.textContent).toContain('ada@example.onmicrosoft.com');
});
