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

function fixture(teamEditable = true) {
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
      bookings: () => [],
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
          { id: 'personal', name: 'Personal', canEdit: true },
          { id: 'team', name: 'Design', teamId: 'team', canEdit: teamEditable },
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

it('shows both owners and keeps link actions and editing within their owner', async () => {
  const { sources, saves } = fixture();
  expect(screen.queryByLabelText('Calendar owner')).toBeNull();
  const team = screen
    .getByRole('button', { name: 'Team planning' })
    .closest('article')!;
  const personal = screen
    .getByRole('button', { name: 'Personal catch-up' })
    .closest('article')!;
  expect(within(team).getByText('Team · Design')).toBeTruthy();
  expect(within(personal).getByText('Personal', { exact: true })).toBeTruthy();
  expect(within(team).getByRole('link').getAttribute('href')).toBe(
    '/book/team/meeting'
  );
  expect(within(personal).getByRole('link').getAttribute('href')).toBe(
    '/book/personal/meeting'
  );

  fireEvent.click(within(team).getByRole('switch'));
  await waitFor(() => expect(saves).toHaveBeenCalledOnce());
  expect(sources.get('team')!.profile()!.eventTypes[0].enabled).toBe(false);
  expect(sources.get('personal')!.profile()!.eventTypes[0].enabled).toBe(true);

  const personalPageName = screen.getAllByRole('textbox', {
    name: 'Display name',
  })[0];
  fireEvent.input(personalPageName, { target: { value: 'Personal draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Team planning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save test event' }));
  await screen.findByRole('button', {
    name: 'Team planning edited',
  });
  expect(sources.get('personal')!.profile()!.eventTypes[0].title).toBe(
    'Personal catch-up'
  );
  expect((personalPageName as HTMLInputElement).value).toBe('Personal draft');
  expect(
    screen.getByRole('button', { name: 'Personal catch-up' })
  ).toBeTruthy();
});

it('searches all owners without switching other sections and preserves read-only team access', () => {
  fixture(false);
  const team = screen
    .getByRole('button', { name: 'Team planning' })
    .closest('article')!;
  expect(within(team).getByRole('switch').hasAttribute('disabled')).toBe(true);
  expect(
    within(team).queryByRole('button', { name: 'Options for Team planning' })
  ).toBeNull();
  fireEvent.input(
    screen.getByRole('searchbox', { name: 'Search booking links' }),
    { target: { value: 'Design' } }
  );
  expect(
    screen.queryByRole('button', { name: 'Personal catch-up' })
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Team planning' })).toBeTruthy();
  expect(screen.getAllByRole('textbox', { name: 'Display name' })).toHaveLength(
    2
  );
  fireEvent.click(screen.getByRole('button', { name: 'New booking link' }));
  expect(screen.getByRole('button', { name: 'Save test event' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Team planning' })).toBeTruthy();
});

it('creates a link for the chosen owner without replacing other owners or their drafts', async () => {
  const { sources } = fixture();
  const personalPageName = screen.getAllByRole('textbox', {
    name: 'Display name',
  })[0];
  fireEvent.input(personalPageName, { target: { value: 'Keep this draft' } });
  fireEvent.keyDown(screen.getByRole('button', { name: 'New booking link' }), {
    key: 'Enter',
  });
  const teamOption = await screen.findByRole('menuitem', {
    name: 'Team · Design',
  });
  teamOption.focus();
  fireEvent.keyDown(teamOption, { key: 'Enter' });
  await screen.findByRole('button', { name: 'Save test event' });
  expect(
    screen.getByRole('button', { name: 'Personal catch-up' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save test event' }));
  await waitFor(() =>
    expect(sources.get('team')!.profile()!.eventTypes).toHaveLength(2)
  );
  expect(sources.get('personal')!.profile()!.eventTypes).toHaveLength(1);
  expect((personalPageName as HTMLInputElement).value).toBe('Keep this draft');
});
