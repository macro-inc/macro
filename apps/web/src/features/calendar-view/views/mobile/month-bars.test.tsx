// @vitest-environment jsdom
import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '@app/features/calendar/types';
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
import { PhoneMonthBars } from './month-bars';

const actions = vi.hoisted(() => ({
  gotoDate: vi.fn(),
  navigateToDate: vi.fn(),
  changeView: vi.fn(),
  create: vi.fn(),
  select: vi.fn(),
}));
vi.mock('@app/features/calendar/context/calendar-navigation-context', () => ({
  useCalendarNavigation: () => actions,
}));
vi.mock('../../components/use-open-event-composer', () => ({
  useOpenEventComposer: () => actions.create,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
const EVENT: CalendarEvent = {
  id: JSON.stringify(['event', '2026-11-20']),
  eventId: 'event',
  occurrenceKey: '2026-11-20',
  isCancelled: false,
  isReadOnly: false,
  guestPolicy: DEFAULT_GUEST_POLICY,
  viewerCan: NO_VIEWER_CAPABILITIES,
  attendees: [],
  recurrenceLines: [],
  title: 'Roadmap review',
  start: '2026-11-20T09:00:00',
  end: '2026-11-20T10:00:00',
  allDay: false,
  sourceCalendarIds: ['calendar'],
  calendarId: 'calendar',
  calendar: { id: 'calendar', name: 'Calendar', color: 'var(--color-accent)' },
  visibleCalendars: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 20, 12));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('opens a selected day sheet without leaving Month, then opens its event', async () => {
  render(() => (
    <PhoneMonthBars
      range={undefined}
      initialDate={new Date(2026, 10, 20)}
      events={[EVENT]}
      showWeekends
      timeFormat="12-hour"
      onFocusHandled={() => {}}
      onSelect={actions.select}
    />
  ));
  const day = screen.getByRole('button', { name: 'Friday, November 20, 2026' });
  expect(day.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(day);
  expect(day.getAttribute('aria-pressed')).toBe('true');
  const sheet = await screen.findByRole('dialog', { name: 'Day events' });
  expect(sheet.textContent).toContain('Roadmap review');
  expect(actions.changeView).not.toHaveBeenCalled();
  fireEvent.click(sheet.querySelector('[data-calendar-month-event]')!);
  expect(actions.select).toHaveBeenCalledWith(EVENT, expect.any(HTMLElement));
});

it('opens all events from the overflow count and selects a hidden event', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('phone-month-card')
        ? new DOMRect(0, 0, 350, 415)
        : new DOMRect();
    }
  );
  const events = Array.from({ length: 7 }, (_, index) => ({
    ...EVENT,
    id: `overflow-${index}`,
    title: `Planning ${index + 1}`,
  }));
  render(() => (
    <PhoneMonthBars
      range={undefined}
      initialDate={new Date(2026, 10, 20)}
      events={events}
      showWeekends
      timeFormat="12-hour"
      onFocusHandled={() => {}}
      onSelect={actions.select}
    />
  ));
  const title = document.querySelector(
    '.phone-month-bar .calendar-event-title'
  );
  expect(
    title?.nextElementSibling?.classList.contains('calendar-event-time')
  ).toBe(true);
  expect(title?.nextElementSibling?.textContent).toBe('9am');
  const day = screen.getByRole('button', { name: 'Friday, November 20, 2026' });
  // Two larger row slots fit: one event plus the six hidden events' count.
  fireEvent.click(within(day).getByText('+6'));
  const sheet = await screen.findByRole('dialog', { name: 'Day events' });
  expect(sheet.querySelectorAll('[data-calendar-month-event]')).toHaveLength(7);
  fireEvent.click(within(sheet).getByRole('button', { name: /Planning 7/ }));
  expect(actions.select).toHaveBeenCalledWith(
    events[6],
    expect.any(HTMLElement)
  );
  expect(actions.changeView).not.toHaveBeenCalled();
});

it('opens Day only from the sheet title and creates on the selected day', async () => {
  render(() => (
    <PhoneMonthBars
      range={undefined}
      initialDate={new Date(2026, 10, 20)}
      events={[]}
      showWeekends
      timeFormat="12-hour"
      onFocusHandled={() => {}}
      onSelect={actions.select}
    />
  ));
  fireEvent.click(
    screen.getByRole('button', { name: 'Tuesday, November 24, 2026' })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Create event on selected day' })
  );
  expect(actions.create).toHaveBeenCalledWith({
    initialValues: expect.objectContaining({
      start: '2026-11-24',
      end: '2026-11-24',
      allDay: true,
    }),
  });
  expect(actions.changeView).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Wednesday, November 25, 2026' })
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Open day view' }));
  expect(actions.gotoDate).toHaveBeenCalledWith(new Date(2026, 10, 25));
  expect(actions.changeView).toHaveBeenCalledWith('timeGridDay');
});

it('omits weekend cells and keeps a focused occurrence reachable in its sheet', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const handled = vi.fn();
  render(() => (
    <PhoneMonthBars
      range={undefined}
      initialDate={new Date(2026, 10, 20)}
      events={[EVENT]}
      showWeekends={false}
      timeFormat="12-hour"
      focusTarget={{
        requestId: 1,
        requestedAt: Date.now(),
        eventId: 'event',
        occurrenceKey: '2026-11-20',
        date: new Date(2026, 10, 20),
      }}
      onFocusHandled={handled}
      onSelect={actions.select}
    />
  ));
  expect(
    screen.queryByRole('button', { name: 'Sunday, November 22, 2026' })
  ).toBeNull();
  await waitFor(() => expect(handled).toHaveBeenCalledWith(1));
  expect(actions.select).toHaveBeenCalledWith(EVENT, expect.any(HTMLElement));
});

it('navigates an external focus request beyond a five-week face before opening its day', async () => {
  render(() => (
    <PhoneMonthBars
      range={undefined}
      initialDate={new Date(2026, 10, 20)}
      events={[]}
      showWeekends
      timeFormat="12-hour"
      focusTarget={{
        requestId: 2,
        requestedAt: Date.now(),
        eventId: 'next',
        occurrenceKey: '2026-12-08',
        date: new Date(2026, 11, 8),
      }}
      onFocusHandled={() => {}}
      onSelect={actions.select}
    />
  ));
  await waitFor(() =>
    expect(actions.navigateToDate).toHaveBeenCalledWith(new Date(2026, 11, 8))
  );
  expect(screen.queryByRole('dialog', { name: 'Day events' })).toBeNull();
});

it.each(['tap', 'dismiss then tap'])(
  'lets %s supersede unresolved focus and ignores its late event',
  async (action) => {
    const [events, setEvents] = createSignal<CalendarEvent[]>([]);
    const handled = vi.fn();
    render(() => (
      <PhoneMonthBars
        range={undefined}
        initialDate={new Date(2026, 10, 20)}
        events={events()}
        showWeekends
        timeFormat="12-hour"
        focusTarget={{
          requestId: 3,
          requestedAt: Date.now(),
          eventId: 'event',
          occurrenceKey: '2026-11-20',
          date: new Date(2026, 10, 20),
        }}
        onFocusHandled={handled}
        onSelect={actions.select}
      />
    ));
    const sheet = await screen.findByRole('dialog', { name: 'Day events' });
    if (action === 'dismiss then tap') {
      await waitFor(() =>
        expect(sheet.contains(document.activeElement)).toBe(true)
      );
      fireEvent.keyDown(sheet, { key: 'Escape' });
      await waitFor(() =>
        expect(sheet.hasAttribute('data-closing')).toBe(true)
      );
    }
    // JSDOM retains transitioning layers; dispatch the next day intent directly.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Tuesday, November 24, 2026',
        hidden: true,
      })
    );
    expect(
      screen.getByRole('button', { name: 'Open day view' }).textContent
    ).toContain('November 24');
    expect(handled).toHaveBeenCalledWith(3);
    setEvents([EVENT]);
    expect(actions.select).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Open day view' }).textContent
    ).toContain('November 24');
  }
);

it('announces event titles including overflow through the day button description', () => {
  const events = Array.from({ length: 7 }, (_, index) => ({
    ...EVENT,
    id: `event-${index}`,
    title: `Review ${index + 1}`,
  }));
  render(() => (
    <PhoneMonthBars
      range={undefined}
      initialDate={new Date(2026, 10, 20)}
      events={events}
      showWeekends
      timeFormat="12-hour"
      onFocusHandled={() => {}}
      onSelect={actions.select}
    />
  ));
  expect(
    screen.getByRole('button', {
      name: 'Friday, November 20, 2026',
      description:
        'Review 1; Review 2; Review 3; Review 4; Review 5; Review 6; Review 7',
    })
  ).toBeTruthy();
});
