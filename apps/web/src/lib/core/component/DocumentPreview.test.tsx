import type { PreviewItem } from '@queries/preview/types';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  item: undefined as unknown,
  openDocument: vi.fn(),
  openExternalUrl: vi.fn(),
  openCalendarEventSplit: vi.fn(),
}));
vi.mock('@app/features/calendar-view/open-calendar-event', () => ({
  openCalendarEventSplit: mocks.openCalendarEventSplit,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/BlockLink',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    openDocument: mocks.openDocument,
  })
);
vi.mock('@core/util/url', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openExternalUrl: mocks.openExternalUrl,
}));
vi.mock('./ItemPreview', () => ({
  useItemPreviewData: () => ({
    item: () => mocks.item,
    ItemEntityIcon: () => null,
    documentProperties: () => undefined,
  }),
}));
// The preview's import graph opens the storage and connection-gateway sockets.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./AccessErrorViews/Unauthorized', () => ({
  default: (props: { noun?: string }) => (
    <p>You don't have access to this {props.noun ?? 'file'}</p>
  ),
}));
vi.mock('./AccessErrorViews/NotFound', () => ({
  default: (props: { message?: string }) => (
    <p>{props.message ?? 'Not found'}</p>
  ),
}));
// The actions own their calendar queries; the card only decides whether and
// for which event to show them.
vi.mock('@app/features/calendar-view/components/SharedEventActions', () => ({
  SharedEventActions: (props: { eventId: string }) => (
    <p>Shared event actions for {props.eventId}</p>
  ),
}));

import { DocumentPreviewContent } from './DocumentPreview';
import { DocumentPreviewSheet } from './DocumentPreviewSheet';

function calendarItem(event: Partial<CalendarMentionEvent>): PreviewItem {
  return {
    id: 'mentioned-event',
    type: 'calendar_event',
    access: 'access',
    loading: false,
    rawName: 'Pilates',
    name: 'Pilates',
    updatedAt: '2026-09-23T17:04:00Z',
    event: {
      title: 'Pilates',
      description: 'Bring a <b>mat</b> <script>alert(1)</script>',
      time: {
        kind: 'timed',
        startsAt: '2026-09-23T23:00:00Z',
        endsAt: '2026-09-23T23:30:00Z',
      },
      occurrenceKey: '2026-09-23T23:00:00+00:00',
      isRecurring: false,
      attendeeCount: 1,
      organizerEmail: 'gab@macro.com',
      updatedAt: '2026-09-23T17:04:00Z',
      viewerEventId: 'viewer-copy',
      ...event,
    },
  };
}

function renderCard() {
  return render(() => (
    <DocumentPreviewContent
      documentInfo={{
        id: 'mentioned-event',
        type: 'calendar',
        params: {},
        isOpenable: true,
      }}
    />
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.item = calendarItem({});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('calendar mention preview card', () => {
  it("opens the viewer's own copy and shows its description", () => {
    const view = renderCard();

    expect(screen.getByRole('button', { name: 'Pilates' })).toBeTruthy();
    expect(screen.queryByText(/not on your calendar/)).toBeNull();
    expect(screen.queryByText(/Shared event actions/)).toBeNull();
    expect(view.container.textContent).toContain('Bring a mat');
    expect(view.container.querySelector('b')?.textContent).toBe('mat');
    expect(view.container.querySelector('script')).toBeNull();
  });

  // The byline's last-updated time reads as the meeting time on a calendar
  // card, which already shows the event's own schedule.
  it('omits the last-updated byline', () => {
    const view = renderCard();

    expect(view.container.textContent).not.toContain('5:04');
    expect(view.container.textContent).not.toMatch(/Sep 23, 2026/);
  });

  it('is read-only for a channel-shared meeting', () => {
    mocks.item = calendarItem({ viewerEventId: null });
    const view = renderCard();

    expect(
      screen.getByText(/Shared with you · not on your calendar/)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pilates' })).toBeNull();
    expect(view.container.textContent).toContain('Pilates');
    expect(view.container.textContent).toContain('Bring a mat');
    expect(
      screen.getByText('Shared event actions for mentioned-event')
    ).toBeTruthy();
  });

  it('shows no event details without access', () => {
    mocks.item = {
      id: 'mentioned-event',
      type: 'calendar_event',
      access: 'no_access',
      loading: false,
    } satisfies PreviewItem;
    const view = renderCard();

    expect(
      screen.getByText("You don't have access to this event")
    ).toBeTruthy();
    expect(view.container.textContent).not.toContain('Pilates');
  });

  // The preview reports a deleted or cancelled meeting as missing; the card
  // a click or tap shows must say so about an event, not a file.
  it('says a deleted meeting is gone, on the card and the phone sheet', async () => {
    mocks.item = {
      id: 'mentioned-event',
      type: 'calendar_event',
      access: 'does_not_exist',
      loading: false,
    } satisfies PreviewItem;
    renderCard();

    expect(
      screen.getByText('This event was deleted or cancelled.')
    ).toBeTruthy();
    expect(screen.queryByText('Not found')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    cleanup();

    render(() => (
      <DocumentPreviewSheet
        open
        onOpenChange={vi.fn()}
        documentInfo={{
          id: 'mentioned-event',
          type: 'calendar',
          params: {},
          isOpenable: true,
        }}
      />
    ));
    expect(
      await screen.findByText('This event was deleted or cancelled.')
    ).toBeTruthy();
  });

  it('opens description links like the event view does', () => {
    mocks.item = calendarItem({
      description:
        'See <a href="https://macro.com/app/md/doc-1?line=3">notes</a> and <a href="https://zoom.us/j/1">Zoom</a>',
    });
    renderCard();

    fireEvent.click(screen.getByText('notes'));
    expect(mocks.openDocument).toHaveBeenCalledWith(
      'md',
      'doc-1',
      { line: '3' },
      false
    );

    fireEvent.click(screen.getByText('Zoom'));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://zoom.us/j/1');
  });
});

describe('calendar mention card for a Macro call', () => {
  const callUrl = 'https://macro.com/app/meet/join/abcdefghijklmnop';
  const call = {
    location: callUrl,
    description: `<p>Agenda</p><p>Join Macro call: <a href="${callUrl}">${callUrl}</a></p>`,
  };

  it('joins from one row instead of printing the link', () => {
    mocks.item = calendarItem(call);
    const view = renderCard();

    expect(view.container.textContent).not.toContain('/meet/join/');
    expect(view.container.textContent).toContain('Agenda');

    fireEvent.click(screen.getByRole('button', { name: 'Join Macro call' }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(callUrl);
  });

  it('keeps a typed location beside the join row', () => {
    mocks.item = calendarItem({ ...call, location: 'Room 2' });
    const view = renderCard();

    expect(view.container.textContent).toContain('Room 2');
    expect(
      screen.getByRole('button', { name: 'Join Macro call' })
    ).toBeTruthy();
  });

  // Channel shares carry the meeting, not a way into its call: the .ics
  // download and the imported snapshot leave the link out the same way.
  it('gives a channel-shared meeting neither the link nor a join row', () => {
    mocks.item = calendarItem({ ...call, viewerEventId: null });
    const view = renderCard();

    expect(view.container.textContent).not.toContain('/meet/join/');
    expect(view.container.textContent).toContain('Agenda');
    expect(
      screen.queryByRole('button', { name: 'Join Macro call' })
    ).toBeNull();
  });

  it('leaves a Google Meet link where it was', () => {
    const meetUrl = 'https://meet.google.com/abc-defg-hij';
    mocks.item = calendarItem({ location: meetUrl });
    const view = renderCard();

    expect(view.container.textContent).toContain(meetUrl);
    expect(
      screen.queryByRole('button', { name: 'Join Macro call' })
    ).toBeNull();
  });

  // Native apps route the link in-app, behind the sheet.
  it('closes the phone sheet once Join has left it', async () => {
    mocks.item = calendarItem(call);
    const onOpenChange = vi.fn();
    render(() => (
      <DocumentPreviewSheet
        open
        onOpenChange={onOpenChange}
        documentInfo={{
          id: 'mentioned-event',
          type: 'calendar',
          params: {},
          isOpenable: true,
        }}
      />
    ));

    fireEvent.click(
      await screen.findByRole('button', { name: 'Join Macro call' })
    );

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(callUrl);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('calendar mention card for a meeting the viewer holds', () => {
  it.each([
    ['snapshot', 'Your copy is on your calendar'],
    ['invitation', 'You’re invited · on your calendar'],
    ['event', 'On your calendar'],
    [undefined, 'On your calendar'],
  ] as const)('says a %s copy is on their calendar', (viewerCopy, label) => {
    mocks.item = calendarItem({ viewerCopy });
    renderCard();

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/Shared event actions/)).toBeNull();
  });

  it('opens the viewer’s own copy from Open', () => {
    mocks.item = calendarItem({ viewerCopy: 'invitation' });
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(mocks.openCalendarEventSplit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'viewer-copy',
        occurrenceKey: '2026-09-23T23:00:00+00:00',
        openInNewSplit: false,
      })
    );
  });

  // Native apps keep the pane behind a stacked pane mounted, so the sheet
  // would otherwise stay over the event Open just showed.
  it.each([
    ['Open', 'Open'],
    ['the title', 'Pilates'],
  ])('closes the phone sheet once %s opens the copy', async (_, name) => {
    mocks.item = calendarItem({ viewerCopy: 'snapshot' });
    mocks.openCalendarEventSplit.mockResolvedValueOnce(true);
    const onOpenChange = vi.fn();
    render(() => (
      <DocumentPreviewSheet
        open
        onOpenChange={onOpenChange}
        documentInfo={{
          id: 'mentioned-event',
          type: 'calendar',
          params: {},
          isOpenable: true,
        }}
      />
    ));

    fireEvent.click(await screen.findByRole('button', { name }));

    expect(mocks.openCalendarEventSplit).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'viewer-copy' })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the phone sheet up when nothing could open', async () => {
    mocks.item = calendarItem({ viewerCopy: 'snapshot' });
    mocks.openCalendarEventSplit.mockResolvedValueOnce(false);
    const onOpenChange = vi.fn();
    render(() => (
      <DocumentPreviewSheet
        open
        onOpenChange={onOpenChange}
        documentInfo={{
          id: 'mentioned-event',
          type: 'calendar',
          params: {},
          isOpenable: true,
        }}
      />
    ));

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(mocks.openCalendarEventSplit).toHaveBeenCalled()
    );
    await Promise.resolve();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('adds nothing to a mention of the viewer’s own copy', () => {
    mocks.item = calendarItem({
      viewerEventId: 'mentioned-event',
      viewerCopy: 'event',
    });
    renderCard();

    expect(screen.queryByText('On your calendar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pilates' })).toBeTruthy();
  });
});

describe('a mention card for an item that is gone or hidden', () => {
  it.each([
    ['md', 'document', "This document was deleted or doesn't exist."],
    ['channel', 'channel', "This channel was deleted or doesn't exist."],
    ['skill', 'document', "This skill was deleted or doesn't exist."],
    ['task', 'document', "This task was deleted or doesn't exist."],
    ['database', 'database', "This database was deleted or doesn't exist."],
    ['form', 'form', "This form was deleted or doesn't exist."],
    ['routine', 'routine', "This routine was deleted or doesn't exist."],
    [
      'agent',
      'agent_session',
      "This agent session was deleted or doesn't exist.",
    ],
  ] as const)('names a deleted %s', (blockName, type, message) => {
    mocks.item = {
      id: 'mentioned-item',
      type,
      access: 'does_not_exist',
      loading: false,
    } satisfies PreviewItem;
    render(() => (
      <DocumentPreviewContent
        documentInfo={{
          id: 'mentioned-item',
          type: blockName,
          params: {},
          isOpenable: true,
        }}
      />
    ));

    expect(screen.getByText(message)).toBeTruthy();
  });

  it.each([
    ['md', 'document', 'document'],
    ['channel', 'channel', 'channel'],
    ['skill', 'document', 'skill'],
    ['database', 'database', 'database'],
    ['form', 'form', 'form'],
    ['routine', 'routine', 'routine'],
    ['agent', 'agent_session', 'agent session'],
  ] as const)('names a %s the viewer can’t open', (blockName, type, noun) => {
    mocks.item = {
      id: 'mentioned-item',
      type,
      access: 'no_access',
      loading: false,
    } satisfies PreviewItem;
    render(() => (
      <DocumentPreviewContent
        documentInfo={{
          id: 'mentioned-item',
          type: blockName,
          params: {},
          isOpenable: true,
        }}
      />
    ));

    expect(
      screen.getByText(`You don't have access to this ${noun}`)
    ).toBeTruthy();
  });
});
