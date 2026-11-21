import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DateField, StartDue } from '../../utils/start-due';
import { StartDueSelector } from './StartDueSelector';

type Change = { dates: StartDue; changed: DateField[] };

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderSelector(initial: StartDue, field: DateField) {
  const changes: Change[] = [];
  const onClose = vi.fn();
  const [dates, setDates] = createSignal(initial);
  render(() => (
    <StartDueSelector
      dates={dates()}
      field={field}
      names={{ start: 'Start Date', due: 'Due Date' }}
      onChange={(next, changed) => {
        changes.push({ dates: next, changed });
        setDates(next);
      }}
      onClose={onClose}
    />
  ));
  return { changes, onClose };
}

function day(date: number) {
  return screen.getByRole('button', { name: String(date) });
}

describe('StartDueSelector', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', ObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 10));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sets the due date from a suggestion in one click, as before', () => {
    const { changes, onClose } = renderSelector(
      { start: null, due: null },
      'due'
    );

    fireEvent.click(screen.getByText('Tomorrow', { selector: 'p' }));

    expect(changes).toEqual([
      {
        dates: { start: null, due: new Date(2026, 10, 21, 23, 59, 59, 999) },
        changed: ['due'],
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('sets the start, at the start of its day, once its field is active', () => {
    const { changes } = renderSelector(
      { start: null, due: new Date(2026, 10, 27) },
      'due'
    );

    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    expect(screen.getByPlaceholderText('Set start date...')).toBeTruthy();
    fireEvent.click(screen.getByText('Tomorrow', { selector: 'p' }));

    expect(changes.at(-1)).toEqual({
      dates: { start: new Date(2026, 10, 21), due: new Date(2026, 10, 27) },
      changed: ['start'],
    });
  });

  it('picks a range in the calendar, start then due', () => {
    const { changes, onClose } = renderSelector(
      { start: null, due: null },
      'start'
    );

    fireEvent.click(screen.getByText('Custom date...'));
    fireEvent.click(day(23));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(day(27));

    expect(changes).toEqual([
      {
        dates: { start: new Date(2026, 10, 23), due: null },
        changed: ['start'],
      },
      {
        dates: { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) },
        changed: ['due'],
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the active end's month when switching ends in the calendar", () => {
    renderSelector(
      { start: new Date(2026, 10, 23), due: new Date(2026, 11, 9) },
      'due'
    );

    fireEvent.click(screen.getByText('Custom date...'));
    expect(screen.getByText('December 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    expect(screen.getByText('November 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Due/ }));
    expect(screen.getByText('December 2026')).toBeTruthy();
  });

  it('makes a due day before the start the new start instead', () => {
    const { changes, onClose } = renderSelector(
      { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) },
      'due'
    );

    fireEvent.click(screen.getByText('Custom date...'));
    fireEvent.click(day(18));

    expect(changes).toEqual([
      {
        dates: { start: new Date(2026, 10, 18), due: new Date(2026, 10, 27) },
        changed: ['start'],
      },
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the length and clears the start or both', () => {
    const { changes } = renderSelector(
      { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) },
      'due'
    );

    expect(screen.getByText('5 days')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear start' }));
    expect(changes.at(-1)).toEqual({
      dates: { start: null, due: new Date(2026, 10, 27) },
      changed: ['start'],
    });
    expect(screen.queryByText('5 days')).toBeNull();
  });

  it('clears both ends at once', () => {
    const { changes } = renderSelector(
      { start: new Date(2026, 10, 23), due: new Date(2026, 10, 27) },
      'start'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear both' }));

    expect(changes).toEqual([
      { dates: { start: null, due: null }, changed: ['start', 'due'] },
    ]);
  });
});
