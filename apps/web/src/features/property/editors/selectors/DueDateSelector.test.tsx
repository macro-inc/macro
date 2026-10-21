/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { isSameDay } from 'date-fns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DueDateSelector } from './DueDateSelector';

afterEach(cleanup);

describe('DueDateSelector', () => {
  it('sets today from the shortcut and closes', () => {
    const onSelectDate = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <DueDateSelector
        selectedDate={null}
        onSelectDate={onSelectDate}
        onClose={onClose}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(onSelectDate).toHaveBeenCalledOnce();
    const picked = onSelectDate.mock.calls[0][0] as Date;
    expect(isSameDay(picked, new Date())).toBe(true);
    expect(picked.getHours()).toBe(0);
    expect(picked.getMinutes()).toBe(0);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clears a date that is already set', () => {
    const onSelectDate = vi.fn();
    render(() => (
      <DueDateSelector
        selectedDate={new Date(2026, 9, 19)}
        onSelectDate={onSelectDate}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onSelectDate).toHaveBeenCalledWith(null);
  });
});
