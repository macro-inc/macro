import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CalendarNavigationProvider,
  useCalendarNavigation,
} from './calendar-navigation-context';

afterEach(cleanup);

it('exposes live dates and forwards navigation without changing their timing', () => {
  const [date, setDate] = createSignal(new Date(2026, 10, 1));
  const gotoDate = vi.fn();
  const navigateToToday = vi.fn();
  const navigation = {
    periodView: () => 'timeGridWeek' as const,
    activeDate: date,
    navigationDate: date,
    displayRange: () => ({ start: date(), end: new Date(2026, 10, 8) }),
    weekRange: () => ({ start: date(), end: new Date(2026, 10, 8) }),
    visibleRange: () => ({ start: date(), end: new Date(2026, 10, 8) }),
    gotoDate,
    navigateToDate: vi.fn(),
    navigateToToday,
    previousPeriod: vi.fn(),
    nextPeriod: vi.fn(),
    changeView: vi.fn(),
  };

  function Controls() {
    const context = useCalendarNavigation();
    return (
      <>
        <span>{context.navigationDate()?.getDate()}</span>
        <button onClick={() => context.gotoDate(new Date(2026, 10, 3))}>
          Jump
        </button>
        <button onClick={context.navigateToToday}>Today</button>
      </>
    );
  }

  render(() => (
    <CalendarNavigationProvider value={navigation}>
      <Controls />
    </CalendarNavigationProvider>
  ));
  expect(screen.getByText('1').textContent).toBe('1');
  setDate(new Date(2026, 10, 2));
  expect(screen.getByText('2').textContent).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
  expect(gotoDate).toHaveBeenCalledWith(new Date(2026, 10, 3));
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(navigateToToday).toHaveBeenCalledOnce();
});
