import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DateTimeRange } from './date-time-range-fields';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe('DateTimeRange parts', () => {
  it('composes date and time independently and rolls the end past midnight', async () => {
    const onStartChange = vi.fn();
    const onEndChange = vi.fn();
    render(() => (
      <DateTimeRange.Root
        subject="event"
        id="event-start-date"
        start="2025-01-01T20:00"
        end="2025-01-01T21:00"
        allDay={false}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
      >
        <DateTimeRange.StartDate />
        <DateTimeRange.EndDate />
        <DateTimeRange.StartTime />
        <DateTimeRange.EndTime />
      </DateTimeRange.Root>
    ));

    expect(
      screen.getByRole('button', { name: 'Edit event start date' }).id
    ).toBe('event-start-date');
    const endTime = screen.getByRole('combobox', { name: 'event end time' });
    await userEvent.click(endTime);
    expect(
      screen
        .getByRole('option', { name: '9:00 PM 1h' })
        .getAttribute('aria-selected')
    ).toBe('true');
    await userEvent.keyboard('7{Enter}');
    expect(onEndChange).toHaveBeenCalledExactlyOnceWith('2025-01-02T07:00');
    expect(onStartChange).not.toHaveBeenCalled();
  });

  it('hides time parts for all-day ranges and carries locks and errors to dates', () => {
    render(() => (
      <DateTimeRange.Root
        subject="event"
        start="2025-01-01"
        end="2025-01-02"
        allDay
        onStartChange={vi.fn()}
        onEndChange={vi.fn()}
        startDisabled
        invalid
        describedBy="range-error"
      >
        <DateTimeRange.StartDate />
        <DateTimeRange.StartTime />
        <DateTimeRange.EndDate />
        <DateTimeRange.EndTime />
      </DateTimeRange.Root>
    ));

    expect(screen.queryByRole('combobox')).toBeNull();
    const startDate = screen.getByRole('button', {
      name: 'Edit event start date',
    });
    expect(startDate.hasAttribute('disabled')).toBe(true);
    expect(startDate.getAttribute('aria-invalid')).toBe('true');
    expect(startDate.getAttribute('aria-describedby')).toBe('range-error');
  });
});
