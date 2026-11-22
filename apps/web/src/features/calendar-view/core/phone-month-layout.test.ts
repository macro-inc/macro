import { agendaEventsByDay } from '@app/features/calendar/primitives/agenda-window';
import { describe, expect, it } from 'vitest';
import {
  layoutPhoneMonthWeek,
  phoneMonthBarCapacity,
  phoneMonthRange,
} from './phone-month-layout';

describe('phone Month geometry', () => {
  it('starts on Sunday and allocates five or six complete weeks', () => {
    const november = phoneMonthRange(new Date(2026, 10, 20));
    expect(november.start).toEqual(new Date(2026, 10, 1));
    expect(november.end).toEqual(new Date(2026, 11, 6));
    expect(november.weekCount).toBe(5);
    const january = phoneMonthRange(new Date(2027, 0, 15));
    expect(january.start).toEqual(new Date(2026, 11, 27));
    expect(january.end).toEqual(new Date(2027, 1, 7));
    expect(january.weekCount).toBe(6);
    expect(phoneMonthRange(new Date(2026, 1, 1)).weekCount).toBe(5);
  });

  it('reduces visible slots when the sheet has less height', () => {
    expect(phoneMonthBarCapacity(573, 5)).toBe(5);
    expect(phoneMonthBarCapacity(573, 6)).toBe(4);
    expect(phoneMonthBarCapacity(580, 6)).toBe(4);
    expect(phoneMonthBarCapacity(360, 6)).toBe(1);
  });

  it('keeps multi-day bars in shared lanes with exclusive ends', () => {
    const events = [
      {
        id: 'span',
        start: '2026-11-08',
        end: '2026-11-12',
        allDay: true,
        isCancelled: false,
      },
      {
        id: 'second',
        start: '2026-11-09',
        end: '2026-11-11',
        allDay: true,
        isCancelled: false,
      },
      {
        id: 'timed',
        start: '2026-11-09T10:00:00',
        end: '2026-11-09T11:00:00',
        allDay: false,
        isCancelled: false,
      },
    ];
    const days = agendaEventsByDay(events, new Date(2026, 10, 8), 7);
    const week = layoutPhoneMonthWeek(days, 5);
    expect(
      week.bars.map(({ event, lane, startColumn, endColumn }) => ({
        id: event.id,
        lane,
        startColumn,
        endColumn,
      }))
    ).toEqual([
      { id: 'span', lane: 0, startColumn: 0, endColumn: 4 },
      { id: 'second', lane: 1, startColumn: 1, endColumn: 3 },
      { id: 'timed', lane: 2, startColumn: 1, endColumn: 2 },
    ]);
    expect(days[4]?.events).toEqual([]);
    expect(week.hidden).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('clips spans to each week and compresses hidden weekend columns', () => {
    const events = [
      {
        id: 'long',
        start: '2026-10-29',
        end: '2026-11-10',
        allDay: true,
        isCancelled: false,
      },
      {
        id: 'weekend',
        start: '2026-11-07',
        end: '2026-11-09',
        allDay: true,
        isCancelled: false,
      },
    ];
    const days = agendaEventsByDay(events, new Date(2026, 10, 1), 7).filter(
      ({ date }) => date.getDay() !== 0 && date.getDay() !== 6
    );
    const week = layoutPhoneMonthWeek(days, 5);
    expect(week.bars).toHaveLength(1);
    expect(week.bars[0]).toMatchObject({
      startColumn: 0,
      endColumn: 5,
      lane: 0,
    });
    const nextWeek = layoutPhoneMonthWeek(
      agendaEventsByDay(events, new Date(2026, 10, 8), 7),
      5
    );
    expect(
      nextWeek.bars.find(({ event }) => event.id === 'long')
    ).toMatchObject({ startColumn: 0, endColumn: 2 });
  });

  it('reserves the last slot for each day’s actual hidden event count', () => {
    const events = Array.from({ length: 7 }, (_, index) => ({
      id: `event-${index}`,
      start: '2026-11-09',
      end: '2026-11-10',
      allDay: true,
      isCancelled: false,
    }));
    const week = layoutPhoneMonthWeek(
      agendaEventsByDay(events, new Date(2026, 10, 8), 7),
      5
    );
    expect(week.bars).toHaveLength(4);
    expect(week.hidden).toEqual([0, 3, 0, 0, 0, 0, 0]);
    const sixWeek = layoutPhoneMonthWeek(
      agendaEventsByDay(events, new Date(2026, 10, 8), 7),
      4
    );
    expect(sixWeek.bars).toHaveLength(3);
    expect(sixWeek.hidden[1]).toBe(4);
  });

  it('does not take a fitting day’s last slot when a different day overflows', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `monday-${index}`,
        start: '2026-11-09',
        end: '2026-11-10',
        allDay: true,
        isCancelled: false,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `tuesday-${index}`,
        start: '2026-11-10',
        end: '2026-11-11',
        allDay: true,
        isCancelled: false,
      })),
    ];
    const week = layoutPhoneMonthWeek(
      agendaEventsByDay(events, new Date(2026, 10, 8), 7),
      5
    );
    expect(week.bars.filter((bar) => bar.startColumn === 1)).toHaveLength(5);
    expect(week.hidden).toEqual([0, 0, 2, 0, 0, 0, 0]);
  });

  it('keeps a crossing bar’s lane on both sides of an overflowing cell', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `span-${index}`,
        start: '2026-11-09',
        end: '2026-11-12',
        allDay: true,
        isCancelled: false,
      })),
      {
        id: 'extra',
        start: '2026-11-10',
        end: '2026-11-11',
        allDay: true,
        isCancelled: false,
      },
    ];
    const week = layoutPhoneMonthWeek(
      agendaEventsByDay(events, new Date(2026, 10, 8), 7),
      5
    );
    expect(
      week.bars
        .filter((bar) => bar.event.id === 'span-4')
        .map(({ lane, startColumn, endColumn }) => ({
          lane,
          startColumn,
          endColumn,
        }))
    ).toEqual([
      { lane: 4, startColumn: 1, endColumn: 2 },
      { lane: 4, startColumn: 3, endColumn: 4 },
    ]);
    expect(week.hidden).toEqual([0, 0, 2, 0, 0, 0, 0]);
  });
});
