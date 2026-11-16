import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';

afterEach(cleanup);

describe('Calendar event markers', () => {
  it('keeps the ordinary date trigger without markers', () => {
    render(() => <Calendar value={new Date(2026, 10, 12)} />);
    expect(
      screen
        .getByRole('gridcell', { name: '12' })
        .querySelector('[aria-hidden="true"]')
    ).toBeNull();
  });

  it('renders dots and bars inside selectable days without changing week highlighting', () => {
    const onValueChange = vi.fn();
    render(() => (
      <Calendar
        value={new Date(2026, 10, 12)}
        onValueChange={onValueChange}
        highlightedRange={{
          start: new Date(2026, 10, 9),
          end: new Date(2026, 10, 16),
        }}
        markersByDay={
          new Map([
            ['2026-11-12', ['red', 'blue', 'green']],
            ['2026-11-13', ['red', 'blue', 'green', 'yellow', 'purple']],
          ])
        }
      />
    ));

    const selected = screen.getByRole('gridcell', { name: '12' });
    const next = screen.getByRole('gridcell', { name: '13' });
    expect(
      selected.querySelectorAll('[style*="background-color"]')
    ).toHaveLength(3);
    expect(next.querySelectorAll('[style*="background-color"]')).toHaveLength(
      4
    );
    expect(next.closest('td')?.hasAttribute('data-highlighted-range')).toBe(
      true
    );
    fireEvent.click(next);
    expect(onValueChange).toHaveBeenCalledWith(new Date(2026, 10, 13));
  });
});
