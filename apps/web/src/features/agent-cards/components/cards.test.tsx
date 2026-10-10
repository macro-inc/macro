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

import { Agenda } from './agenda';
import { EntityCard } from './entity-card';
import { EventCard } from './event-card';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPreview({ loading: true });
  mocks.agenda.data = undefined;
  mocks.event.data = undefined;
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
  it('names a created document as the agent did until it loads', () => {
    const view = render(() => (
      <EntityCard
        type="document"
        id="doc-1"
        fileType="spreadsheet"
        action="created"
        title="Q3 budget"
      />
    ));
    expect(view.getByText('Q3 budget')).toBeTruthy();
    expect(view.getByText('Created')).toBeTruthy();
    expect(view.getByText('Spreadsheet')).toBeTruthy();
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
    const view = render(() => (
      <EntityCard
        type="document"
        id="doc-1"
        action="edited"
        title="Launch FAQ"
      />
    ));
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
    expect(view.getByText('Edited')).toBeTruthy();
  });

  it('says so when the viewer cannot open it', () => {
    setPreview({ loading: false, access: 'no_access', id: 'thread-1' });
    const view = render(() => (
      <EntityCard
        type="email_thread"
        id="thread-1"
        action="sent"
        title="Launch plan"
      />
    ));
    expect(view.getByText('Launch plan')).toBeTruthy();
    expect(view.getByText("Email · You don't have access")).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });
});

describe('an event card', () => {
  it('shows when and where, and opens the viewer’s own copy', async () => {
    mocks.event.data = {
      ...meeting('Design review', at(9, 15), at(9, 15, 30)),
      location: 'Room 4',
    };
    const view = render(() => (
      <EventCard eventId="event-1" action="created" title="Review" />
    ));
    expect(view.getByText('Design review')).toBeTruthy();
    expect(view.getByText('Scheduled')).toBeTruthy();
    expect(view.getByText(/3:00 – 3:30 PM/)).toBeTruthy();
    expect(view.getByText('Room 4')).toBeTruthy();
    await fireEvent.click(view.getByRole('button'));
    expect(mocks.openEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'mine-Design review' })
    );
  });

  it('names the event as the agent did when it is not on the calendar', () => {
    mocks.event.data = null;
    const view = render(() => <EventCard eventId="event-1" title="Offsite" />);
    expect(view.getByText('Offsite')).toBeTruthy();
    expect(view.getByText('Not on your calendar')).toBeTruthy();
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
    expect(view.getByText("1 event isn't on your calendar.")).toBeTruthy();
  });

  it('folds a long agenda behind "Show more" instead of scrolling', async () => {
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
    expect(view.getAllByRole('listitem')).toHaveLength(8);
    await fireEvent.click(view.getByRole('button', { name: 'Show 2 more' }));
    expect(view.getAllByRole('listitem')).toHaveLength(10);
  });

  it('says when there is nothing to show', () => {
    mocks.agenda.data = [];
    const view = render(() => <Agenda events={[]} />);
    expect(view.getByText('No events to show.')).toBeTruthy();
  });
});
