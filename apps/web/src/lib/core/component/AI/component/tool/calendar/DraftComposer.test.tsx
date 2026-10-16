import type { EventFormProps } from '@app/features/calendar/components/composer/EventForm';
import type { VisibleCalendar } from '@queries/calendar/calendars';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import type { Link } from '@service-email/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calendars: [] as VisibleCalendar[],
  links: [] as Link[],
  calendarError: false,
  linksError: false,
  refetchCalendars: vi.fn(),
  refetchLinks: vi.fn(),
  startAddInbox: vi.fn(),
  execute: vi.fn(),
  quickCalls: () => ({ loading: false, enabled: true }),
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => mocks.quickCalls(),
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({
    isSuccess: !mocks.calendarError,
    isError: mocks.calendarError,
    data: mocks.calendars,
    refetch: mocks.refetchCalendars,
  }),
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    isSuccess: !mocks.linksError,
    isError: mocks.linksError,
    data: { links: mocks.links },
    refetch: mocks.refetchLinks,
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|self' }));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => mocks.startAddInbox,
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  recipientEntityMapper: () => (value: unknown) => value,
}));
vi.mock('@ui', () => ({
  Layer: (props: { children: JSX.Element }) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('./EventPreview', () => ({ CalendarToolEventPreview: () => null }));
vi.mock('@app/features/calendar/components/composer/EventForm', () => ({
  EventForm: (props: EventFormProps) => (
    <>
      <select
        aria-label="Calendar"
        value={props.controller.effectiveCalendarId() ?? ''}
        onChange={(event) =>
          props.controller.setField('calendarId', event.currentTarget.value)
        }
      >
        <option value="">Choose calendar</option>
        <For each={props.controller.calendarOptions()}>
          {(option) => <option value={option.id}>{option.label}</option>}
        </For>
      </select>
      <output aria-label="Macro calls enabled">
        {String(props.macroCallsEnabled)}
      </output>
      <output aria-label="Conference">
        {props.controller.state().conference}
      </output>
      <button
        type="button"
        onClick={() => props.controller.setField('conference', 'macro')}
      >
        Pick Macro call
      </button>
      <button
        disabled={
          !props.controller.canSave() || props.disabled || props.pending
        }
        onClick={() => {
          const values = props.controller.submitValues();
          if (values) props.onSubmit(values);
        }}
      >
        Create event
      </button>
    </>
  ),
}));

import { CalendarDraftComposer } from './DraftComposer';

const link = (id: string, overrides: Partial<Link> = {}): Link =>
  ({
    id,
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    is_primary: id === 'work',
    needs_reauth: false,
    needs_calendar_permission: false,
    calendar_disabled: false,
    ...overrides,
  }) as Link;
const calendar = (id: string): VisibleCalendar => ({
  id: `${id}-calendar`,
  emailLinkId: id,
  emailAddress: `${id}@example.com`,
  name: id,
  isPrimary: true,
  isWritable: true,
  isSubscription: false,
  defaultReminders: [],
});

function showDraft(
  calendarId?: string,
  overrides: Partial<CreateCalendarEvent> = {}
) {
  const draft = {
    title: 'Customer demo',
    calendarId,
    time: {
      kind: 'timed',
      startsAt: '2030-01-01T12:00:00Z',
      endsAt: '2030-01-01T13:00:00Z',
    },
    ...overrides,
  } as CreateCalendarEvent;
  return render(() => (
    <CalendarDraftComposer
      initialData={draft}
      previewKey="test"
      showPreview={false}
      sink={{
        canAct: () => true,
        lockedNotice: () => undefined,
        onExecute: mocks.execute,
        onReject: async () => true,
      }}
    />
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue(true);
  mocks.startAddInbox.mockResolvedValue(undefined);
  mocks.quickCalls = () => ({ loading: false, enabled: true });
  mocks.calendarError = false;
  mocks.linksError = false;
  mocks.links = [link('personal'), link('work')];
  mocks.calendars = [calendar('personal'), calendar('work')];
});
afterEach(cleanup);

describe('AI calendar draft account selection', () => {
  it.each([
    { calendarError: true, linksError: false },
    { calendarError: false, linksError: true },
    { calendarError: true, linksError: true },
  ])(
    'offers retry instead of consent for failed queries: %j',
    async (errors) => {
      Object.assign(mocks, errors);
      showDraft();
      expect(screen.getByText('Could not load your calendars.')).not.toBeNull();
      expect(screen.queryByText(/Wait for it to sync/)).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: /Connect calendar|Reconnect calendar/,
        })
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Create event' })
      ).toHaveProperty('disabled', true);
      await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(mocks.refetchCalendars).toHaveBeenCalledTimes(
        Number(errors.calendarError)
      );
      expect(mocks.refetchLinks).toHaveBeenCalledTimes(
        Number(errors.linksError)
      );
      expect(mocks.startAddInbox).not.toHaveBeenCalled();
    }
  );

  it('defaults to the primary inbox even when a personal calendar is listed first', async () => {
    showDraft();
    await fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'work-calendar' })
    );
  });

  it('requires a choice while the primary calendar is backfilling', async () => {
    mocks.calendars = [calendar('personal')];
    showDraft();
    const submit = screen.getByRole('button', { name: 'Create event' });
    expect(submit).toHaveProperty('disabled', true);
    expect(screen.getByText(/Wait for it to sync/)).not.toBeNull();
    await fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'personal-calendar' },
    });
    expect(submit).toHaveProperty('disabled', false);
    await fireEvent.click(submit);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'personal-calendar' })
    );
  });

  it('rejects a cached writable calendar whose Google grant expired and reconnects the right account', async () => {
    mocks.links = [link('personal'), link('work', { needs_reauth: true })];
    showDraft('work-calendar');
    expect(screen.getByRole('button', { name: 'Create event' })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.queryByRole('option', { name: 'work' })).toBeNull();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Reconnect calendar' })
    );
    expect(mocks.startAddInbox).toHaveBeenCalledExactlyOnceWith({
      scopes: 'gmail_and_calendar',
      emailAddress: 'work@example.com',
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not replace a deleted requested calendar with the primary calendar', () => {
    showDraft('deleted-calendar');
    expect(screen.getByRole('button', { name: 'Create event' })).toHaveProperty(
      'disabled',
      true
    );
    expect(
      screen.getByText(/requested calendar is unavailable/)
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Connect calendar' })
    ).not.toBeNull();
  });

  it.each([false, true])(
    'does not reconnect the primary inbox for a removed calendar account (primary expired: %s)',
    async (needsReauth) => {
      mocks.links = [link('work', { needs_reauth: needsReauth })];
      showDraft('personal-calendar');
      expect(
        screen.getByRole('button', { name: 'Create event' })
      ).toHaveProperty('disabled', true);
      expect(
        screen.queryByRole('button', { name: 'Reconnect calendar' })
      ).toBeNull();
      await fireEvent.click(
        screen.getByRole('button', { name: 'Connect calendar' })
      );
      expect(mocks.startAddInbox).toHaveBeenCalledExactlyOnceWith({
        scopes: 'gmail_and_calendar',
      });
    }
  );
});

describe('AI calendar draft Macro calls', () => {
  it('offers Macro calls under the quick-calls flag', () => {
    const [flag, setFlag] = createSignal({ loading: false, enabled: false });
    mocks.quickCalls = flag;
    showDraft();
    expect(screen.getByLabelText('Macro calls enabled').textContent).toBe(
      'false'
    );
    setFlag({ loading: false, enabled: true });
    expect(screen.getByLabelText('Macro calls enabled').textContent).toBe(
      'true'
    );
  });

  it('opens on the conferencing the agent drafted', () => {
    showDraft(undefined, { addMacroCall: true });
    expect(screen.getByLabelText('Conference').textContent).toBe('macro');
  });

  it('executes the tool with addMacroCall when the user picks a Macro call', async () => {
    showDraft(undefined, {
      attendees: [{ email: 'guest@example.com' }],
      addGoogleMeet: false,
    });
    expect(screen.getByLabelText('Conference').textContent).toBe('none');
    await fireEvent.click(
      screen.getByRole('button', { name: 'Pick Macro call' })
    );
    expect(screen.getByLabelText('Conference').textContent).toBe('macro');
    await fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        addMacroCall: true,
        addGoogleMeet: false,
        attendees: [{ email: 'guest@example.com' }],
      })
    );
  });
});
