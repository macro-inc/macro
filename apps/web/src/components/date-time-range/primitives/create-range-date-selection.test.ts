import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DateTimeRangeValue } from '../time-range';
import { createRangeDateSelection } from './create-range-date-selection';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function picker(startDisabled = false, endDisabled = false) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [value, setValue] = createSignal<DateTimeRangeValue>({
      allDay: false,
      start: '2030-01-01T23:00',
      end: '2030-01-02T01:00',
    });
    const changed = vi.fn((next: DateTimeRangeValue) => setValue(next));
    const source = createRangeDateSelection({
      value,
      onChange: changed,
      startDisabled: () => startDisabled,
      endDisabled: () => endDisabled,
    });
    return { source, value, changed };
  });
}

it('commits both dates only after the range is complete, keeping the wall-clock times', () => {
  const { source, value, changed } = picker();
  source.open('start');
  source.change({ from: new Date(2030, 1, 3), to: null });
  expect(source.state.endpoint).toBe('end');
  expect(changed).not.toHaveBeenCalled();
  source.change({ from: new Date(2030, 1, 3), to: new Date(2030, 1, 4) });
  expect(value()).toEqual({
    allDay: false,
    start: '2030-02-03T23:00',
    end: '2030-02-04T01:00',
  });
  expect(source.state.open).toBe(false);
});

it('drops an incomplete range on dismissal and restores current values on reopen', () => {
  const { source, changed } = picker();
  source.open('start');
  source.change({ from: new Date(2030, 1, 3), to: null });
  source.close();
  expect(changed).not.toHaveBeenCalled();
  source.open('start');
  expect(source.state.draft).toEqual({
    from: new Date(2030, 0, 1),
    to: new Date(2030, 0, 2),
  });
});

it('keeps a partial start when the end trigger is opened', () => {
  const { source, value } = picker();
  source.open('start');
  source.change({ from: new Date(2030, 1, 3), to: null });
  source.open('end');
  expect(source.state.draft.from).toEqual(new Date(2030, 1, 3));
  source.change({ from: new Date(2030, 1, 3), to: new Date(2030, 1, 4) });
  expect(value().start).toBe('2030-02-03T23:00');
});

it('does not move a locked start or accept a range before it', () => {
  const { source, value, changed } = picker(true);
  expect(source.open('start')).toBe(false);
  expect(source.open('end')).toBe(true);
  source.change({ from: new Date(2029, 11, 30), to: new Date(2030, 0, 1) });
  expect(changed).not.toHaveBeenCalled();
  source.change({ from: new Date(2030, 0, 1), to: new Date(2030, 0, 3) });
  expect(value()).toEqual({
    allDay: false,
    start: '2030-01-01T23:00',
    end: '2030-01-03T01:00',
  });
});

it('can move only the start when the end is locked', () => {
  const { source, value } = picker(false, true);
  expect(source.open('end')).toBe(false);
  source.open('start');
  source.change({ from: new Date(2029, 11, 31), to: null });
  expect(value()).toEqual({
    allDay: false,
    start: '2029-12-31T23:00',
    end: '2030-01-02T01:00',
  });
});
