/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  openEvent: vi.fn(),
  agenda: { isPending: false, isError: false, data: undefined as unknown },
  event: { isPending: false, isError: false, data: undefined as unknown },
  routine: {
    isPending: false,
    isSuccess: true,
    isError: false,
    data: undefined as unknown,
  },
  setEnabled: vi.fn(),
  runNow: vi.fn(),
}));
const [preview, setPreview] = createSignal<Record<string, unknown>>({
  loading: true,
});

vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: () => ({
    item: preview,
    name: () => preview().name,
    targetType: () => 'md',
    onPreviewClick: mocks.open,
  }),
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <i data-icon={props.targetType} />
  ),
}));
vi.mock('@app/features/calendar-view/open-calendar-event', () => ({
  openCalendarEventSplit: mocks.openEvent,
}));
vi.mock('@queries/calendar/mention-preview', () => ({
  useCalendarMentionPreviewQuery: () => mocks.event,
  useCalendarSearchPreviewsQuery: () => mocks.agenda,
}));
vi.mock('@app/features/routines/queries/routines', () => ({
  useRoutineQuery: () => mocks.routine,
}));
vi.mock('@app/features/routines/queries/schedules', () => ({
  useSetScheduleEnabledMutation: () => ({
    mutate: mocks.setEnabled,
    isPending: false,
  }),
  useRunScheduleNowMutation: () => ({ mutate: mocks.runNow, isPending: false }),
}));

import { Agenda } from './agenda';
import { EventCard } from './event-card';
import { ReferenceCard } from './reference-card';
import { RoutineCard, routineSchedule, routineState } from './routine-card';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPreview({ loading: true });
  mocks.agenda.isPending = false;
  mocks.agenda.data = undefined;
  mocks.event.data = undefined;
  mocks.routine.data = undefined;
  mocks.routine.isError = false;
  mocks.routine.isSuccess = true;
});

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const meeting = (title: string, startsAt: string, endsAt: string) => ({
  title,
  time: { kind: 'timed', startsAt, endsAt },
  attendeeCount: 4,
  isRecurring: false,
  updatedAt: startsAt,
  viewerEventId: `mine-${title}`,
});

describe('an item card', () => {
  it('names the kind of item until it loads, and cannot open it yet', () => {
    const view = render(() => (
      <ReferenceCard type="document" id="doc-1" fileType="spreadsheet" />
    ));
    expect(view.getAllByText('Spreadsheet')).toHaveLength(2);
    expect(
      view.container.querySelector('[data-icon]')?.getAttribute('data-icon')
    ).toBe('spreadsheet');
    expect(view.queryByRole('button')).toBeNull();
  });

  it('opens the item once it loads, under its current name', async () => {
    setPreview({
      loading: false,
      access: 'access',
      id: 'doc-1',
      type: 'document',
      name: 'Launch FAQ (final)',
      rawName: 'Launch FAQ (final)',
      fileType: 'md',
    });
    const view = render(() => <ReferenceCard type="document" id="doc-1" />);
    await fireEvent.click(
      view.getByRole('button', { name: 'Open Launch FAQ (final)' })
    );
    expect(mocks.open).toHaveBeenCalledWith(
      'document',
      'doc-1',
      'md',
      undefined,
      false
    );
  });

  it('says so when the viewer cannot open it, without what is inside', () => {
    setPreview({ loading: false, access: 'no_access', id: 'thread-1' });
    const view = render(() => (
      <ReferenceCard type="email_thread" id="thread-1" />
    ));
    expect(view.getByText("Email · You don't have access")).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('strikes through an item that is gone', () => {
    setPreview({ loading: false, access: 'does_not_exist', id: 'doc-1' });
    const view = render(() => <ReferenceCard type="document" id="doc-1" />);
    expect(view.getByText('Document').className).toContain('line-through');
    expect(view.getByText('Document · Deleted')).toBeTruthy();
  });
});

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const routine = (overrides: Record<string, unknown> = {}) => ({
  id: 'routine-1',
  name: 'Weekly pipeline digest',
  enabled: true,
  owner: 'macro|ana@example.com',
  kind: 'agent_task',
  configuration_revision: 1,
  created_at: at(9, 9),
  updated_at: at(9, 9),
  next_run_at: at(13, 8),
  trigger: { type: 'cron', schedule: '0 0 8 * * 2', timezone: localZone },
  task: {},
  ...overrides,
});

describe('a routine card', () => {
  it('shows the routine live: its state, schedule and next run', () => {
    mocks.routine.data = routine();
    const view = render(() => <RoutineCard id="routine-1" />);
    expect(view.getByText('Weekly pipeline digest')).toBeTruthy();
    expect(view.getByText('Active')).toBeTruthy();
    expect(view.getByText('Monday at 8:00 AM')).toBeTruthy();
    expect(view.getByText(/at 8 AM$/)).toBeTruthy();
  });

  it('pauses, runs and opens the routine from the card', () => {
    mocks.routine.data = routine();
    const view = render(() => <RoutineCard id="routine-1" />);
    fireEvent.click(view.getByRole('button', { name: 'Pause' }));
    expect(mocks.setEnabled).toHaveBeenCalledWith({
      scheduleId: 'routine-1',
      enabled: false,
    });
    fireEvent.click(view.getByRole('button', { name: 'Run now' }));
    expect(mocks.runNow).toHaveBeenCalledWith({ scheduleId: 'routine-1' });
    fireEvent.click(view.getByRole('button', { name: 'Open' }));
    expect(mocks.open).toHaveBeenCalledWith(
      'routine',
      'routine-1',
      undefined,
      undefined,
      false
    );
  });

  it('offers to resume a paused routine instead of a next run', () => {
    mocks.routine.data = routine({ enabled: false });
    const view = render(() => <RoutineCard id="routine-1" />);
    expect(view.getByText('Paused')).toBeTruthy();
    expect(view.getByText('None while paused')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('falls back to a plain card for a viewer who cannot read it', () => {
    mocks.routine.isError = true;
    mocks.routine.isSuccess = false;
    setPreview({ loading: false, access: 'no_access', id: 'routine-1' });
    const view = render(() => <RoutineCard id="routine-1" />);
    expect(view.getByText("Routine · You don't have access")).toBeTruthy();
  });

  it('words its schedule and state from the stored routine', () => {
    const weekdays = routine({
      trigger: {
        type: 'cron',
        schedule: '0 30 9 * * 2-6',
        timezone: 'Asia/Tokyo',
      },
    });
    expect(routineSchedule(weekdays as never)).toBe(
      localZone === 'Asia/Tokyo'
        ? 'Weekdays at 9:30 AM'
        : 'Weekdays at 9:30 AM (Asia/Tokyo)'
    );
    expect(routineState(routine({ enabled: false }) as never)).toBe('paused');
    expect(
      routineState(routine({ claimed: new Date().toISOString() }) as never)
    ).toBe('running');
    expect(routineState(routine({ next_run_at: null }) as never)).toBe('idle');
  });
});

describe('an event card', () => {
  it('shows when and where, and opens the viewer’s own copy', async () => {
    mocks.event.data = {
      ...meeting('Design review', at(9, 15), at(9, 15, 30)),
      location: 'Room 4',
    };
    const view = render(() => <EventCard eventId="event-1" />);
    expect(view.getByText('Design review')).toBeTruthy();
    expect(view.getByText(/3 – 3:30 PM · Room 4/)).toBeTruthy();
    await fireEvent.click(view.getByRole('button'));
    expect(mocks.openEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'mine-Design review' })
    );
  });

  it('says so when the event is not on the viewer’s calendar', () => {
    mocks.event.data = null;
    const view = render(() => <EventCard eventId="event-1" />);
    expect(view.getByText('Event · Not on your calendar')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });
});

describe('an agenda', () => {
  const access = (eventId: string, event: unknown) => ({
    type: 'access',
    eventId,
    event,
  });

  it('groups events by day in time order and counts the ones it cannot show', () => {
    mocks.agenda.data = [
      access('b', meeting('Review', at(9, 15), at(9, 16))),
      access('a', meeting('Standup', at(9, 9), at(9, 9, 15))),
      { type: 'no_access', eventId: 'c' },
    ];
    const view = render(() => (
      <Agenda
        title="Your day"
        events={[{ eventId: 'b' }, { eventId: 'a' }, { eventId: 'c' }]}
      />
    ));
    const rows = view
      .getAllByRole('button')
      .map((row) => row.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual([
      expect.stringContaining('Standup'),
      expect.stringContaining('Review'),
    ]);
    expect(view.getByRole('region', { name: 'Your day' })).toBeTruthy();
    expect(view.getByText("1 event isn't on your calendar")).toBeTruthy();
  });

  it('holds a long agenda at a fixed height instead of growing', () => {
    mocks.agenda.data = Array.from({ length: 10 }, (_, index) =>
      access(
        `e${index}`,
        meeting(`Event ${index}`, at(9, 8 + index), at(9, 9 + index))
      )
    );
    const view = render(() => (
      <Agenda
        events={Array.from({ length: 10 }, (_, index) => ({
          eventId: `e${index}`,
        }))}
      />
    ));
    const card = view.container.querySelector<HTMLElement>(
      '[data-agent-card="agenda"]'
    );
    expect(card?.style.height).toBe('320px');
    expect(view.getAllByText(/^Event \d$/)).toHaveLength(10);
    expect(view.getAllByText('10 events').length).toBeGreaterThan(0);
  });

  it('says when there is nothing to show, without waiting on a load', () => {
    // With no events there is nothing to fetch: the query stays pending.
    mocks.agenda.isPending = true;
    const view = render(() => <Agenda events={[]} />);
    expect(view.getByText('No events to show.')).toBeTruthy();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
