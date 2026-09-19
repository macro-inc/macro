/**
 * @vitest-environment jsdom
 */

import {
  Calendar,
  type DatesSetArg,
  type EventContentArg,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import { render, screen, waitFor } from '@solidjs/testing-library';
import {
  createContext,
  createSignal,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullCalendar, useFullCalendar } from './FullCalendar';

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FullCalendar Solid connector', () => {
  it('composes a host and context-aware Solid content', () => {
    const AppContext = createContext('missing');
    const [prefix, setPrefix] = createSignal('Planning');

    function ContextualEvent(props: { event: EventContentArg }) {
      const appValue = useContext(AppContext);
      const calendar = useFullCalendar();

      return (
        <span data-testid="event-content">
          {appValue}: {calendar.api()?.view.type}: {prefix()}:{' '}
          {props.event.event.title}
        </span>
      );
    }

    render(() => (
      <AppContext.Provider value="inherited">
        <FullCalendar.Root
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          initialDate="2025-01-15"
          headerToolbar={false}
          handleWindowResize={false}
          events={[{ id: 'planning', title: 'Planning', start: '2025-01-15' }]}
        >
          <FullCalendar.EventContent>
            {(event) => <ContextualEvent event={event} />}
          </FullCalendar.EventContent>
          <FullCalendar.Host
            class="calendar-host"
            data-testid="calendar-host"
          />
        </FullCalendar.Root>
      </AppContext.Provider>
    ));

    expect(screen.getByTestId('calendar-host').className).toContain(
      'calendar-host'
    );
    expect(screen.getByTestId('event-content').textContent).toBe(
      'inherited: dayGridMonth: Planning: Planning'
    );

    setPrefix('Updated');

    expect(screen.getByTestId('event-content').textContent).toBe(
      'inherited: dayGridMonth: Updated: Planning'
    );
  });

  it('reacts to root options and exposes the calendar API through context', async () => {
    const [events, setEvents] = createSignal([
      { id: 'first', title: 'First', start: '2025-01-15' },
    ]);
    let calendarContext: ReturnType<typeof useFullCalendar> | undefined;

    function CalendarContextCapture() {
      calendarContext = useFullCalendar();
      return null;
    }

    const getCalendar = () => {
      const api = calendarContext?.api();
      if (!api) throw new Error('Calendar API was not set');
      return api;
    };

    render(() => (
      <FullCalendar.Root
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        initialDate="2025-01-15"
        headerToolbar={false}
        handleWindowResize={false}
        events={events()}
      >
        <CalendarContextCapture />
        <FullCalendar.Host />
      </FullCalendar.Root>
    ));

    expect(
      getCalendar()
        .getEvents()
        .map((event) => event.title)
    ).toEqual(['First']);

    setEvents([{ id: 'first', title: 'Updated', start: '2025-01-16' }]);

    await waitFor(() => {
      expect(
        getCalendar()
          .getEvents()
          .map((event) => event.title)
      ).toEqual(['Updated']);
    });
  });

  it('exposes date info before invoking the datesSet callback', () => {
    let calendarContext: ReturnType<typeof useFullCalendar> | undefined;

    function CalendarContextCapture() {
      calendarContext = useFullCalendar();
      return null;
    }

    const datesSet = vi.fn((dateInfo: DatesSetArg) => {
      expect(calendarContext?.dateInfo()).toBe(dateInfo);
    });

    const { unmount } = render(() => (
      <FullCalendar.Root
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        initialDate="2025-01-15"
        headerToolbar={false}
        handleWindowResize={false}
        datesSet={datesSet}
      >
        <CalendarContextCapture />
        <FullCalendar.Host />
      </FullCalendar.Root>
    ));

    expect(datesSet).toHaveBeenCalledOnce();
    expect(calendarContext?.dateInfo()?.view.type).toBe('dayGridMonth');
    expect(calendarContext?.api()?.view.type).toBe('dayGridMonth');

    const initialStart = calendarContext?.dateInfo()?.start.getTime();
    calendarContext?.api()?.next();

    expect(datesSet).toHaveBeenCalledTimes(2);
    expect(calendarContext?.dateInfo()?.start.getTime()).not.toBe(initialStart);

    unmount();

    expect(calendarContext?.api()).toBeUndefined();
    expect(calendarContext?.dateInfo()).toBeUndefined();
  });

  it('reacts to content children and dynamically registers them', async () => {
    const resetOptions = vi.spyOn(Calendar.prototype, 'resetOptions');
    const [showCustomContent, setShowCustomContent] = createSignal(true);
    const [renderEvent, setRenderEvent] = createSignal(
      (event: EventContentArg) => (
        <span data-testid="custom-event">Custom {event.event.title}</span>
      )
    );

    const { container } = render(() => (
      <FullCalendar.Root
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        initialDate="2025-01-15"
        headerToolbar={false}
        handleWindowResize={false}
        events={[{ id: 'planning', title: 'Planning', start: '2025-01-15' }]}
      >
        <Show when={showCustomContent()}>
          <FullCalendar.EventContent>{renderEvent()}</FullCalendar.EventContent>
        </Show>
        <FullCalendar.Host />
      </FullCalendar.Root>
    ));

    expect(screen.getByTestId('custom-event').textContent).toBe(
      'Custom Planning'
    );

    resetOptions.mockClear();
    setRenderEvent(() => (event: EventContentArg) => (
      <span data-testid="custom-event">Updated {event.event.title}</span>
    ));

    expect(screen.getByTestId('custom-event').textContent).toBe(
      'Updated Planning'
    );
    expect(resetOptions).not.toHaveBeenCalled();

    setShowCustomContent(false);

    await waitFor(() => {
      expect(screen.queryByTestId('custom-event')).toBeNull();
      expect(container.textContent).toContain('Planning');
    });

    setShowCustomContent(true);

    await waitFor(() => {
      expect(screen.getByTestId('custom-event').textContent).toBe(
        'Updated Planning'
      );
    });
  });

  it('destroys FullCalendar and disposes registered content on unmount', () => {
    const destroy = vi.spyOn(Calendar.prototype, 'destroy');
    const disposeContent = vi.fn();

    function EventContent() {
      onCleanup(disposeContent);
      return <span data-testid="owned-content">Owned content</span>;
    }

    const { unmount } = render(() => (
      <FullCalendar.Root
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        initialDate="2025-01-15"
        headerToolbar={false}
        handleWindowResize={false}
        events={[{ id: 'planning', title: 'Planning', start: '2025-01-15' }]}
      >
        <FullCalendar.EventContent>
          {() => <EventContent />}
        </FullCalendar.EventContent>
        <FullCalendar.Host />
      </FullCalendar.Root>
    ));

    expect(screen.getByTestId('owned-content').isConnected).toBe(true);

    unmount();

    expect(destroy).toHaveBeenCalledOnce();
    expect(disposeContent).toHaveBeenCalledOnce();
  });
});
