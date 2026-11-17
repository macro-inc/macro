import type { RootRangeProps } from '@corvu/calendar';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarRange } from './CalendarRange';

afterEach(cleanup);

it('keeps a partial selection and completes an inclusive range', async () => {
  const onChange = vi.fn();
  const [value, setValue] = createSignal<RootRangeProps['value']>({
    from: null,
    to: null,
  });
  render(() => (
    <CalendarRange
      fixedWeeks
      value={value()}
      initialMonth={new Date(2030, 0, 1)}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  ));
  await userEvent.click(screen.getByRole('gridcell', { name: '12' }));
  expect(onChange).toHaveBeenLastCalledWith({
    from: new Date(2030, 0, 12),
    to: null,
  });
  await userEvent.click(screen.getByRole('gridcell', { name: '18' }));
  expect(onChange).toHaveBeenLastCalledWith({
    from: new Date(2030, 0, 12),
    to: new Date(2030, 0, 18),
  });
  expect(
    screen.getByRole('gridcell', { name: '15' }).getAttribute('aria-selected')
  ).toBe('true');
  expect(
    screen
      .getByRole('gridcell', { name: '12' })
      .hasAttribute('data-range-start')
  ).toBe(true);
  expect(
    screen.getByRole('gridcell', { name: '18' }).hasAttribute('data-range-end')
  ).toBe(true);
});

it('orders a reversed range and retains keyboard selection', async () => {
  const [value, setValue] = createSignal<RootRangeProps['value']>({
    from: null,
    to: null,
  });
  render(() => (
    <CalendarRange
      fixedWeeks
      value={value()}
      initialMonth={new Date(2030, 0, 1)}
      onValueChange={setValue}
    />
  ));
  await userEvent.click(screen.getByRole('gridcell', { name: '20' }));
  await userEvent.click(screen.getByRole('gridcell', { name: '12' }));
  expect(value()).toEqual({
    from: new Date(2030, 0, 12),
    to: new Date(2030, 0, 20),
  });
  screen.getByRole('gridcell', { name: '12' }).focus();
  await userEvent.keyboard('{ArrowRight}{Enter}');
  expect(value()).toEqual({ from: new Date(2030, 0, 13), to: null });
});
