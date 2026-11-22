import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { WHEEL_SETTLE_DELAY_MS } from '../../app/mobile/wheel-picker/create-wheel-column';
import {
  timeFromWheelParts,
  timeWheelMinutes,
  timeWheelParts,
  usesTwelveHourClock,
} from '../time-wheel';
import { TimeWheel } from './TimeWheel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('maps noon and midnight and follows explicit formats before locale defaults', () => {
  expect(timeWheelParts('00:07', true)).toEqual({
    hour: '12',
    minute: '7',
    period: 'am',
  });
  expect(
    timeFromWheelParts({ hour: '12', minute: '0', period: 'am' }, true)
  ).toBe('00:00');
  expect(
    timeFromWheelParts({ hour: '12', minute: '0', period: 'pm' }, true)
  ).toBe('12:00');
  expect(
    timeFromWheelParts({ hour: '3', minute: '5', period: 'pm' }, true)
  ).toBe('15:05');
  expect(usesTwelveHourClock(undefined, 'en-US')).toBe(true);
  expect(usesTwelveHourClock(undefined, 'en-GB')).toBe(false);
  expect(usesTwelveHourClock('24-hour', 'en-US')).toBe(false);
  expect(usesTwelveHourClock('12-hour', 'en-GB')).toBe(true);
});

it('keeps an off-step minute exactly once and then resumes the five-minute grid', () => {
  expect(timeWheelMinutes(7).map((item) => item.value)).toEqual([
    '0',
    '5',
    '7',
    '10',
    '15',
    '20',
    '25',
    '30',
    '35',
    '40',
    '45',
    '50',
    '55',
  ]);
  expect(timeWheelMinutes(10)).toHaveLength(12);
});

it('renders three 12-hour columns and applies each independently', () => {
  const view = render(() => {
    const [value, setValue] = createSignal('11:00');
    return (
      <TimeWheel
        value={value()}
        onChange={setValue}
        format="12-hour"
        label="Start"
      />
    );
  });
  expect(view.getAllByRole('spinbutton')).toHaveLength(3);
  const hour = view.getByRole('spinbutton', { name: 'Hour' });
  fireEvent.keyDown(hour, { key: 'ArrowUp' });
  expect(hour.getAttribute('aria-valuetext')).toBe('12');
  const period = view.getByRole('spinbutton', { name: 'AM or PM' });
  fireEvent.keyDown(period, { key: 'ArrowUp' });
  expect(period.getAttribute('aria-valuetext')).toBe('pm');
});

it('renders two 24-hour columns, zero-padded hours, and a duration', () => {
  const changed = vi.fn();
  const view = render(() => (
    <TimeWheel
      value="09:30"
      onChange={changed}
      format="24-hour"
      label="End"
      duration="30min"
    />
  ));
  expect(view.getAllByRole('spinbutton')).toHaveLength(2);
  const hour = view.getByRole('spinbutton', { name: 'Hour' });
  expect(hour.getAttribute('aria-valuetext')).toBe('09');
  fireEvent.keyDown(hour, { key: 'ArrowUp' });
  expect(changed).toHaveBeenCalledWith('10:30');
  expect(view.getByText('30min')).toBeTruthy();
});

it('applies the snapped minute after native scroll stops', () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const view = render(() => (
    <TimeWheel
      value="11:07"
      onChange={changed}
      format="24-hour"
      label="Start"
    />
  ));
  const minute = view.getByRole('spinbutton', { name: 'Minute' });
  minute.scrollTop += 44;
  fireEvent.scroll(minute);
  vi.advanceTimersByTime(WHEEL_SETTLE_DELAY_MS);
  expect(changed).toHaveBeenCalledExactlyOnceWith('11:10');
});
