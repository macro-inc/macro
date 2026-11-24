import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import type { VisibleCalendar } from '@queries/calendar/calendars';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import type { Link } from '@service-email/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  calendars: [] as VisibleCalendar[],
  links: [] as Link[],
  calendarError: false,
  linksError: false,
  refetchCalendars: vi.fn(),
  refetchLinks: vi.fn(),
  startAddInbox: vi.fn(),
  execute: vi.fn(),
  guestInvites: (): boolean => true,
  touch: false,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock(
  '@app/features/calendar/views/composer/mobile/MobileAgentComposer',
  () => ({
    MobileAgentComposer: (props: {
      model: { submit: () => void; setTimeZone: (zone: string) => void };
      children: JSX.Element;
    }) => (
      <div data-testid="phone-agent-draft">
        {props.children}
        <button onClick={props.model.submit}>Create event</button>
        <button onClick={() => props.model.setTimeZone('America/New_York')}>
          Select zone
        </button>
      </div>
    ),
  })
);
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => () => undefined,
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarGuestInvitesFlag: () => () => mocks.guestInvites(),
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
  recipientEntityMapper: () => (value: unknown) => value,
}));
vi.mock('@ui', async () => {
  const { cn } = await import('@app/components/ui/utils/classname');
  return {
    cn,
    Layer: (props: { children: JSX.Element }) => props.children,
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} />
    ),
  };
});
vi.mock('./EventPreview', () => ({
  CalendarToolEventPreview: (props: {
    timeZone?: string;
    submission?: () =>
      | { time: { kind: string; startsAt?: string } }
      | undefined;
  }) => (
    <>
      <output aria-label="Preview zone">{props.timeZone}</output>
      <output aria-label="Preview start">
        {props.submission?.()?.time.startsAt}
      </output>
    </>
  ),
}));
vi.mock('@app/features/calendar/views/composer/AgentComposer', async () => {
  const { useCalendarComposer } = await import(
    '@app/features/calendar/context/calendar-composer-context'
  );
  return {
    AgentComposer: () => {
      const model = useCalendarComposer();
      const controller = model.controller;
      return (
        <>
          <select
            aria-label="Calendar"
            value={controller.effectiveCalendarId() ?? ''}
            onChange={(event) =>
              controller.setField('calendarId', event.currentTarget.value)
            }
          >
            <option value="">Choose calendar</option>
            <For each={controller.calendarOptions()}>
              {(option) => <option value={option.id}>{option.label}</option>}
            </For>
          </select>
          <output aria-label="Time format">{model.range.timeFormat}</output>
          <output aria-label="Conference">
            {controller.state().conference}
          </output>
          <button
            type="button"
            onClick={() => controller.setField('conference', 'macro')}
          >
            Pick Macro call
          </button>
          <button
            disabled={!model.canSave() || model.formIsDisabled()}
            onClick={model.submit}
          >
            Create event
          </button>
        </>
      );
    },
  };
});

import {
  CalendarDraftComposer,
  type CalendarDraftComposerProps,
} from './DraftComposer';

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
  provider: 'google',
  capabilities: {
    autoDecline: true,
    emailReminders: true,
    customRecurrence: false,
    removeConference: false,
    resetRsvp: false,
    guestPolicy: true,
  },
  defaultReminders: [],
});

function showDraft(
  calendarId?: string,
  overrides: Partial<CreateCalendarEvent> = {},
  registerSubmitReader?: CalendarDraftComposerProps['registerSubmitReader'],
  showPreview = false
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
      registerSubmitReader={registerSubmitReader}
      showPreview={showPreview}
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
  mocks.guestInvites = () => true;
  mocks.touch = false;
  mocks.calendarError = false;
  mocks.linksError = false;
  mocks.links = [link('personal'), link('work')];
  mocks.calendars = [calendar('personal'), calendar('work')];
});
afterEach(cleanup);

it('routes phone drafts through the shared agent model without mounting the desktop form', async () => {
  mocks.touch = true;
  showDraft();
  expect(screen.getByTestId('phone-agent-draft')).not.toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Customer demo',
      calendarId: 'work-calendar',
    })
  );
});

it('previews the same explicit time zone and instant that a review submits', async () => {
  mocks.touch = true;
  let read: (() => Promise<CreateCalendarEvent | undefined>) | undefined;
  showDraft(
    undefined,
    {
      time: {
        kind: 'timed',
        startsAt: '2030-01-01T12:00:00Z',
        endsAt: '2030-01-01T13:00:00Z',
        timeZone: 'UTC',
      },
    },
    (reader) => {
      read = reader;
    },
    true
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select zone' }));
  const submitted = await read?.();
  expect(submitted?.time).toMatchObject({
    kind: 'timed',
    timeZone: 'America/New_York',
  });
  expect(screen.getByLabelText('Preview zone').textContent).toBe(
    'America/New_York'
  );
  if (submitted?.time.kind === 'timed') {
    expect(screen.getByLabelText('Preview start').textContent).toBe(
      submitted.time.startsAt
    );
  }
});

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
  it('opens on the conferencing the agent drafted', () => {
    showDraft(undefined, { addMacroCall: true });
    expect(screen.getByLabelText('Conference').textContent).toBe('macro');
  });

  it('executes the tool with addMacroCall when the user picks a Macro call', async () => {
    showDraft(undefined, {
      attendees: [{ email: 'guest@example.com' }],
      addConference: false,
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
        addConference: false,
        attendees: [{ email: 'guest@example.com' }],
      })
    );
  });
});

describe('AI calendar draft guest permissions', () => {
  const agentPolicy = {
    canModify: false,
    canInviteOthers: false,
    canSeeOtherGuests: true,
  };

  it('creates the event with the guest permissions the agent drafted', async () => {
    showDraft(undefined, { guestPolicy: agentPolicy });
    await fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ guestPolicy: agentPolicy })
    );
  });

  it('leaves the drafted guest permissions out while the rollout is off', async () => {
    mocks.guestInvites = () => false;
    showDraft(undefined, { guestPolicy: agentPolicy });
    await fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0].guestPolicy).toBeUndefined();
  });
});

describe('AI calendar draft time format', () => {
  it('shows the times on the calendar’s clock', () => {
    const [, setPreferences] = useCalendarPreferences();
    setPreferences('timeFormat', '24-hour');
    onTestFinished(() => setPreferences('timeFormat', '12-hour'));
    showDraft();
    expect(screen.getByLabelText('Time format').textContent).toBe('24-hour');
  });
});

describe('calendar batch preparation', () => {
  it('captures the same validated snapshot without creating an event', async () => {
    let read: (() => Promise<CreateCalendarEvent | undefined>) | undefined;
    showDraft(undefined, {}, (reader) => {
      read = reader;
    });
    expect(read).toBeDefined();
    expect(await read?.()).toMatchObject({
      title: 'Customer demo',
      time: { kind: 'timed' },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('cannot prepare an event on an unavailable calendar', async () => {
    let read: (() => Promise<CreateCalendarEvent | undefined>) | undefined;
    showDraft('deleted-calendar', {}, (reader) => {
      read = reader;
    });
    expect(read).toBeDefined();
    expect(await read?.()).toBeUndefined();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
