import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { WhenMonth } from './WhenMonth';

afterEach(cleanup);
it('stages an all-day range and restarts when the second day precedes the first', async () => {
  const change = vi.fn();
  render(() => (
    <WhenMonth
      size="desktop"
      range
      value={new Date(2030, 10, 13)}
      onChange={change}
    />
  ));
  await userEvent.click(screen.getByRole('gridcell', { name: '18' }));
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('gridcell', { name: '16' }));
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('gridcell', { name: '20' }));
  expect(change).toHaveBeenCalledWith(
    new Date(2030, 10, 16),
    new Date(2030, 10, 20)
  );
});
it('prevents choosing an end date before the start', async () => {
  const change = vi.fn();
  render(() => (
    <WhenMonth
      size="phone"
      value={new Date(2030, 10, 13)}
      minimum={new Date(2030, 10, 13)}
      onChange={change}
    />
  ));
  expect(
    screen.getByRole('gridcell', { name: '12' }).hasAttribute('disabled')
  ).toBe(true);
  await userEvent.click(screen.getByRole('gridcell', { name: '14' }));
  expect(change).toHaveBeenCalledWith(new Date(2030, 10, 14));
});
