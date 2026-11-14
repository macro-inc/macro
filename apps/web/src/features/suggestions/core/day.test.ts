import { expect, it } from 'vitest';
import { layoutDay } from './day';

const at = (time: string) => new Date(`2026-11-09T${time}:00`).toISOString();
const event = (id: string, start: string, end: string) => ({
  id,
  title: id,
  start: at(start),
  end: at(end),
});

it('places events across working hours and dims the ones that ended', () => {
  const strip = layoutDay(
    [event('review', '14:00', '15:00'), event('sync', '08:00', '08:30')],
    new Date('2026-11-09T11:00:00')
  );

  expect(
    strip.chips.map((chip) => [chip.event.id, chip.left, chip.past])
  ).toEqual([
    ['sync', 0, true],
    ['review', 50, false],
  ]);
  expect(strip.now).toBe(25);
  expect(strip.hours).toEqual([8, 10, 12, 14, 16, 18, 20]);
});

it('moves an event that would overlap its neighbour onto the second row', () => {
  const strip = layoutDay(
    [
      event('a', '09:00', '10:00'),
      event('b', '09:30', '10:00'),
      event('c', '13:00', '14:00'),
    ],
    new Date('2026-11-09T07:00:00')
  );

  expect(strip.chips.map((chip) => chip.lane)).toEqual([0, 1, 0]);
  expect(strip.now).toBeUndefined();
});

it('keeps two late events, both drawn at the strip’s right edge, on different rows', () => {
  const strip = layoutDay(
    [event('late', '17:00', '18:00'), event('later', '19:00', '19:30')],
    new Date('2026-11-09T07:00:00')
  );

  // Each is drawn where its full width still fits, so they share a position.
  expect(strip.chips.map((chip) => [chip.left, chip.lane])).toEqual([
    [72, 0],
    [72, 1],
  ]);
});

it('leaves out events outside working hours and clamps one that started earlier', () => {
  const strip = layoutDay(
    [
      event('early', '06:00', '07:00'),
      event('spans', '07:30', '09:00'),
      event('late', '21:00', '22:00'),
    ],
    new Date('2026-11-09T12:00:00')
  );

  expect(strip.chips.map((chip) => [chip.event.id, chip.left])).toEqual([
    ['spans', 0],
  ]);
});
