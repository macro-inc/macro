// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ActiveQuickCall,
  CallSidebarSources,
} from '../context/call-sidebar';
import type { UpcomingCalendarEvent } from '../core/upcoming-calendar-events';
import { CallSidebar } from './call-sidebar';

afterEach(cleanup);

const upcoming: UpcomingCalendarEvent[] = Array.from(
  { length: 6 },
  (_, index) => ({
    id: `event-${index}`,
    eventId: `event-${index}`,
    occurrenceKey: '2026-09-24T12:00:00Z',
    title: `Planning ${index + 1}`,
    url: `https://meet.google.com/call-${index}`,
    start: '2026-09-24T12:00:00Z',
    end: '2026-09-24T13:00:00Z',
    allDay: false,
  })
);
const empty = {
  calls: () => [],
  events: () => [],
  loading: () => false,
  error: () => undefined,
  refresh: vi.fn(),
};

function setup(
  overrides: Partial<CallSidebarSources> = {},
  now = () => new Date('2026-09-23T12:00:00Z')
) {
  const sources: CallSidebarSources = {
    upcoming: { ...empty, events: () => upcoming },
    active: empty,
    ...overrides,
  };
  const actions = { join: vi.fn(), openEvent: vi.fn() };
  render(() => (
    <CallSidebar
      sources={sources}
      now={now}
      actions={actions}
      when={() => 'Tomorrow · 8am'}
    />
  ));
  return { sources, actions };
}

it('shows the next five events as detail buttons without phone icons', () => {
  const { actions } = setup();
  expect(screen.queryByText('Planning 6')).toBeNull();
  expect(screen.getByText('Planning 5')).toBeTruthy();
  expect(screen.queryByText('Upcoming')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(5);
  const call = screen.getByRole('button', { name: 'Open Planning 1' });
  expect(call.textContent).toContain('Tomorrow · 8am');
  fireEvent.click(call);
  expect(actions.openEvent).toHaveBeenCalledWith(upcoming[0], call);
  expect(actions.join).not.toHaveBeenCalled();
  expect(call.querySelector('svg')).toBeNull();
});

it('shows active call chips above upcoming calls only while they are active', () => {
  const [active, setActive] = createSignal<ActiveQuickCall[]>([]);
  const { actions } = setup({ active: { ...empty, calls: active } });
  expect(screen.getByText('Planning 1')).toBeTruthy();
  setActive([
    {
      id: 'live',
      createdBy: 'macro|maya@example.com',
      title: 'Design catch-up',
      url: '/meet/live',
    },
  ]);
  expect(screen.getByText('Planning 1')).toBeTruthy();
  expect(screen.getAllByRole('button')[0].getAttribute('aria-label')).toBe(
    'Join Design catch-up'
  );
  expect(screen.queryByText('Active now')).toBeNull();
  expect(screen.getByText('Live now')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Join Design catch-up' }));
  expect(actions.join).toHaveBeenCalledWith('/meet/live');
  setActive([]);
  expect(screen.getByText('Planning 1')).toBeTruthy();
  expect(screen.queryByText('Design catch-up')).toBeNull();
});

it('does not show active-call UI when there are no active calls', () => {
  const retry = vi.fn();
  setup({
    active: {
      ...empty,
      error: () => 'Could not load active calls.',
      refresh: retry,
    },
  });
  expect(screen.getByText('Planning 1')).toBeTruthy();
  expect(screen.queryByText('Could not load active calls.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByText('Checking active calls…')).toBeNull();
});

it('shows a quiet empty state when there are no calls', () => {
  setup({ upcoming: empty });
  expect(screen.getByText('No upcoming events')).toBeTruthy();
});

it('shows Join only for an ongoing event with a call link as time advances', () => {
  const [now, setNow] = createSignal(new Date('2026-09-24T11:59:00Z'));
  const events = [{ ...upcoming[0], url: undefined }, upcoming[1]];
  const { actions } = setup(
    { upcoming: { ...empty, events: () => events } },
    now
  );
  expect(screen.queryByRole('button', { name: 'Join Planning 2' })).toBeNull();
  setNow(new Date('2026-09-24T12:00:00Z'));
  expect(screen.queryByRole('button', { name: 'Join Planning 1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Join Planning 2' }));
  expect(actions.join).toHaveBeenCalledWith(upcoming[1].url);
  expect(actions.openEvent).not.toHaveBeenCalled();
  setNow(new Date('2026-09-24T13:00:00Z'));
  expect(screen.queryByRole('button', { name: 'Join Planning 2' })).toBeNull();
});
