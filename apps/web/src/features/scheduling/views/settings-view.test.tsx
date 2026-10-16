import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type SchedulingCapabilities,
  SchedulingProvider,
  type SchedulingSource,
} from '../context/scheduling-context';
import {
  type Booking,
  newEventType,
  newSchedule,
  type SchedulingProfile,
} from '../core/types';
import { SchedulingSettingsView } from './settings-view';

vi.mock('./insights-view', () => ({ InsightsView: () => <div>Insights</div> }));
vi.mock('../components/event-editor', () => ({
  EventEditor: (props: {
    event: SchedulingProfile['eventTypes'][number];
    onSave: (event: SchedulingProfile['eventTypes'][number]) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      <button
        onClick={() =>
          void props.onSave({
            ...props.event,
            title: `${props.event.title} edited`,
          })
        }
      >
        Save test event
      </button>
      <button onClick={props.onCancel}>Cancel test event</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const future = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

/** A confirmed team meeting hosted by a teammate, not the signed-in user. */
const teammateBooking: Booking = {
  id: 'booking',
  eventTypeId: 'same-event-id',
  title: 'Team planning',
  name: 'Guest',
  email: 'guest@example.com',
  startsAt: future(24),
  endsAt: future(25),
  timeZone: 'UTC',
  hosts: ['teammate'],
  status: 'confirmed',
  attendance: 'unknown',
  rescheduleCount: 0,
  rescheduledAt: null,
  location: '',
  answers: {},
};

function fixture(team = { canEdit: true, canManageBookings: true }) {
  const sources = new Map<string, SchedulingSource>();
  const saves = vi.fn();
  const createSource: SchedulingCapabilities['createSource'] = (scope) => {
    const schedule = { ...newSchedule('UTC'), id: 'same-schedule-id' };
    // Identical IDs ensure actions are routed by owner, not accidental ID matching.
    const event = {
      ...newEventType(schedule.id, ['user'], !!scope().teamId),
      id: 'same-event-id',
      enabled: true,
      title: scope().teamId ? 'Team planning' : 'Personal catch-up',
      slug: 'meeting',
    };
    const [profile, setProfile] = createSignal<SchedulingProfile>({
      id: scope().id,
      name: scope().name,
      description: '',
      schedules: [schedule],
      defaultScheduleId: schedule.id,
      eventTypes: [event],
      revision: 1,
    });
    const source: SchedulingSource = {
      profile,
      bookings: () =>
        scope().teamId
          ? [
              teammateBooking,
              {
                ...teammateBooking,
                id: 'hosted',
                name: 'Own guest',
                hosts: ['user'],
              },
            ]
          : [],
      loading: () => false,
      error: () => undefined,
      saving: () => false,
      save: async (next) => {
        saves(scope().id, next);
        setProfile(next);
      },
      approve: async () => {},
      cancel: async () => {},
      loadInsights: async () => [],
      setAttendance: async () => {},
      reload: () => {},
    };
    sources.set(scope().id, source);
    return source;
  };
  render(() => (
    <SchedulingProvider
      value={{
        scopes: () => [
          {
            id: 'personal',
            name: 'Personal',
            canEdit: true,
            canManageBookings: true,
          },
          { id: 'team', name: 'Design', teamId: 'team', ...team },
        ],
        members: () => [],
        userId: () => 'user',
        createSource,
        copyLink: async () => {},
        link: (p, slug) => `/book/${p.id}/${slug ?? ''}`,
        openTeamSettings: () => {},
        manageBooking: async () => {},
      }}
    >
      <SchedulingSettingsView />
    </SchedulingProvider>
  ));
  return { sources, saves };
}

async function selectOwner(name: string) {
  const trigger = screen.getByRole('button', { name: 'Booking link owner' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() =>
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  );
}

it('scopes actions and creation to the selected owner', async () => {
  const { sources, saves } = fixture();
  expect(
    screen.getByRole('button', { name: 'Personal catch-up' })
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Team planning' })).toBeNull();
  await selectOwner('Team · Design');
  const team = screen
    .getByRole('button', { name: 'Team planning' })
    .closest('article')!;
  expect(within(team).getByRole('link').getAttribute('href')).toBe(
    '/book/team/meeting'
  );
  fireEvent.click(within(team).getByRole('switch'));
  await waitFor(() => expect(saves).toHaveBeenCalledOnce());
  expect(sources.get('team')!.profile()!.eventTypes[0].enabled).toBe(false);
  expect(sources.get('personal')!.profile()!.eventTypes[0].enabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Team planning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save test event' }));
  await screen.findByRole('button', { name: 'Team planning edited' });
  fireEvent.click(screen.getByRole('button', { name: 'New booking link' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save test event' }));
  await waitFor(() =>
    expect(sources.get('team')!.profile()!.eventTypes).toHaveLength(2)
  );
  expect(sources.get('personal')!.profile()!.eventTypes).toHaveLength(1);
});

it('keeps page drafts across navigation and scopes each section', async () => {
  fixture();
  fireEvent.click(screen.getByRole('tab', { name: 'Booking page' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Display name' }), {
    target: { value: 'Keep my draft' },
  });
  await selectOwner('Team · Design');
  expect(
    (screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement)
      .value
  ).toBe('Design');
  fireEvent.click(screen.getByRole('tab', { name: 'Availability' }));
  expect(
    screen.getByRole('group', { name: 'Design availability' })
  ).toBeTruthy();
  expect(
    screen.queryByRole('group', { name: 'Personal availability' })
  ).toBeNull();
  await selectOwner('Personal');
  fireEvent.click(screen.getByRole('tab', { name: 'Booking page' }));
  expect(
    (screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement)
      .value
  ).toBe('Keep my draft');
});

it('preserves read-only access and clears search when switching owners', async () => {
  fixture({ canEdit: false, canManageBookings: false });
  fireEvent.input(
    screen.getByRole('searchbox', { name: 'Search booking links' }),
    { target: { value: 'no match' } }
  );
  expect(screen.getByText('No matching booking links.')).toBeTruthy();
  await selectOwner('Team · Design');
  const team = screen
    .getByRole('button', { name: 'Team planning' })
    .closest('article')!;
  expect(within(team).getByRole('switch').hasAttribute('disabled')).toBe(true);
  expect(
    within(team).queryByRole('button', { name: 'Options for Team planning' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'New booking link' })).toBeNull();
  expect(
    screen.getByText('Only team members can edit these settings.')
  ).toBeTruthy();
});

it('lets a team member edit booking links and manage only the meetings they host', async () => {
  fixture({ canEdit: true, canManageBookings: false });
  await selectOwner('Team · Design');
  expect(screen.getByRole('button', { name: 'New booking link' })).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: 'Bookings' }));
  expect(await screen.findByText('Guest')).toBeTruthy();
  expect(screen.getByText('Own guest')).toBeTruthy();
  // One Cancel and one Reschedule: the meeting they host, not the teammate's.
  expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Reschedule' })).toHaveLength(1);
});
