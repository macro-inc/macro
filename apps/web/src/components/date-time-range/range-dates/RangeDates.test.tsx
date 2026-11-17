import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DateTimeRange } from '../date-time-range-fields';

afterEach(cleanup);

it('edits a same-day end date without writing a locked start', async () => {
  const onStartChange = vi.fn();
  const onEndChange = vi.fn();
  render(() => (
    <DateTimeRange.Root
      subject="event"
      start="2030-01-12T09:00"
      end="2030-01-12T10:00"
      allDay={false}
      startDisabled
      onStartChange={onStartChange}
      onEndChange={onEndChange}
    >
      <DateTimeRange.Dates />
    </DateTimeRange.Root>
  ));

  await userEvent.click(
    screen.getByRole('button', { name: 'Edit event end date' })
  );
  await userEvent.click(screen.getByRole('gridcell', { name: '13' }));
  expect(onStartChange).not.toHaveBeenCalled();
  expect(onEndChange).toHaveBeenCalledExactlyOnceWith('2030-01-13T10:00');
});
