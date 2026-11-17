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

it('starts an evening event at its own time, not earlier so it fits', () => {
  // 18:00 is half way between the 16:00 and 20:00 marks, 5/6 of the strip.
  const strip = layoutDay(
    [event('deploy', '18:00', '18:30')],
    new Date('2026-11-09T18:15:00')
  );

  const [chip] = strip.chips;
  expect(chip?.left).toBeCloseTo((10 / 12) * 100);
  // Narrowed to end at 20:00 instead of moved back to fit its usual width.
  expect(chip?.width).toBeCloseTo((2 / 12) * 100);
  expect(chip?.past).toBe(false);
  expect(strip.now).toBeCloseTo((10.25 / 12) * 100);
});

it('keeps late events at their start times, on different rows when they would meet', () => {
  const strip = layoutDay(
    [event('late', '17:00', '18:00'), event('later', '19:00', '19:30')],
    new Date('2026-11-09T07:00:00')
  );

  const placed = strip.chips.map((chip) => [
    Number(chip.left.toFixed(2)),
    Number(chip.width.toFixed(2)),
    chip.lane,
  ]);
  expect(placed).toEqual([
    [75, 25, 0],
    [91.67, 8.33, 1],
  ]);
});

it('draws an event in the strip’s last half hour no narrower than half an hour', () => {
  const strip = layoutDay(
    [event('wrap-up', '19:50', '20:30')],
    new Date('2026-11-09T07:00:00')
  );

  expect(strip.chips.map((chip) => [chip.left, chip.width])).toEqual([[96, 4]]);
});

it('gives a chip the full width wherever it fits', () => {
  const strip = layoutDay(
    [event('review', '14:00', '15:00')],
    new Date('2026-11-09T07:00:00')
  );

  expect(strip.chips.map((chip) => [chip.left, chip.width])).toEqual([
    [50, 28],
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
