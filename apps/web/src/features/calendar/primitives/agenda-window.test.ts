import { describe, expect, it } from 'vitest';
import {
  agendaEventsByDay,
  agendaWindow,
  agendaWindowIndices,
  clipAgendaWindow,
  groupAgendaDays,
} from './agenda-window';

describe('agenda windows', () => {
  it('keeps the supported portion of a window at either coverage edge', () => {
    const window = {
      start: new Date(2026, 10, 1),
      end: new Date(2026, 10, 15),
    };
    expect(
      clipAgendaWindow(window, {
        start: new Date(2026, 10, 5),
        end: new Date(2026, 11, 1),
      })
    ).toEqual({ start: new Date(2026, 10, 5), end: new Date(2026, 10, 15) });
    expect(
      clipAgendaWindow(window, {
        start: new Date(2026, 9, 1),
        end: new Date(2026, 10, 10),
      })
    ).toEqual({ start: new Date(2026, 10, 1), end: new Date(2026, 10, 10) });
    expect(
      clipAgendaWindow(window, {
        start: new Date(2026, 11, 1),
        end: new Date(2027, 0, 1),
      })
    ).toBeUndefined();
  });
  it('uses fourteen local days across a daylight saving change', () => {
    const { start, end } = agendaWindow(new Date(2026, 2, 7, 15), 0);
    expect(start.getDate()).toBe(7);
    expect(end.getDate()).toBe(21);
    expect(agendaWindowIndices(-2)).toEqual([-2, -1, 0, 1, 2]);
  });
  it('keeps empty days and sorts all-day rows first', () => {
    const timed = {
      id: 'timed',
      start: '2026-11-01T12:00:00',
      end: '2026-11-01T13:00:00',
      allDay: false,
      isCancelled: false,
    };
    const allDay = {
      ...timed,
      id: 'all-day',
      start: '2026-11-01',
      end: '2026-11-02',
      allDay: true,
    };
    const days = agendaEventsByDay([timed, allDay], new Date(2026, 10, 1));
    expect(days).toHaveLength(14);
    expect(days[0]?.events.map((event) => event.id)).toEqual([
      'all-day',
      'timed',
    ]);
    expect(days[1]?.events).toEqual([]);
  });
  it('retains timed point imports but rejects empty all-day intervals', () => {
    const days = agendaEventsByDay(
      [
        {
          id: 'point',
          start: '2026-11-01T12:00:00',
          end: '2026-11-01T12:00:00',
          allDay: false,
          isCancelled: false,
        },
        {
          id: 'empty',
          start: '2026-11-01',
          end: '2026-11-01',
          allDay: true,
          isCancelled: false,
        },
      ],
      new Date(2026, 10, 1)
    );
    expect(days[0]?.events.map((event) => event.id)).toEqual(['point']);
    expect(days[1]?.events).toEqual([]);
  });
  it('places a spanning occurrence on each displayed month day', () => {
    const days = agendaEventsByDay(
      [
        {
          id: 'trip',
          start: '2026-10-31',
          end: '2026-11-03',
          allDay: true,
          isCancelled: false,
        },
      ],
      new Date(2026, 9, 26),
      42
    );
    expect(days).toHaveLength(42);
    expect(
      days
        .filter((day) => day.events.length > 0)
        .map((day) => day.date.getDate())
    ).toEqual([31, 1, 2]);
  });
  it('groups empty ranges without swallowing today or a boundary', () => {
    const days = agendaEventsByDay([], new Date(2026, 10, 20), 6);
    const grouped = groupAgendaDays(
      days,
      new Date(2026, 10, 22),
      (previous, next) => previous.getDate() !== 23 && next.getDate() !== 23
    );
    expect(
      grouped.map(({ start, end }) => [start.getDate(), end.getDate()])
    ).toEqual([
      [20, 21],
      [22, 22],
      [23, 23],
      [24, 25],
    ]);
  });
});
