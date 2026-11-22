import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthDrawer } from './month-drawer';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  today: vi.fn(),
  weekStart: undefined as Date | undefined,
  firstVisibleDay: undefined as Date | undefined,
  period: 'dayGridMonth',
}));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@app/features/calendar/context/calendar-navigation-context', () => ({
  useCalendarNavigation: () => ({
    navigateToDate: state.navigate,
    navigateToToday: state.today,
    periodView: () => state.period,
    weekRange: () =>
      state.weekStart
        ? { start: state.weekStart, end: new Date(2026, 10, 28) }
        : undefined,
    displayRange: () =>
      state.firstVisibleDay
        ? { start: state.firstVisibleDay, end: new Date(2026, 10, 3) }
        : undefined,
  }),
}));
vi.mock('@ui', () => ({ Button: () => null }));
// Keep the sheet lifecycle local; the production wheel and its native scroll
// state are exercised here. Browser focus/drag ownership belongs to MobileDrawer.
vi.mock('@components/app/mobile/MobileDrawer', () => {
  let toggle: () => void;
  return {
    MobileDrawer: Object.assign(
      (props: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        children: JSX.Element;
      }) => {
        toggle = () => props.onOpenChange(!props.open);
        return <div>{props.children}</div>;
      },
      {
        Trigger: (props: { children: JSX.Element }) => (
          <button aria-label="Choose month" onClick={() => toggle()}>
            {props.children}
          </button>
        ),
        Close: (props: { children: JSX.Element; onClick: () => void }) => (
          <button
            onClick={() => {
              props.onClick();
              toggle();
            }}
          >
            {props.children}
          </button>
        ),
        Portal: (props: { children: JSX.Element }) => <>{props.children}</>,
        Overlay: () => null,
        Content: (props: { children: JSX.Element }) => <>{props.children}</>,
        Handle: () => null,
        ScrollBody: (props: { children: JSX.Element }) => <>{props.children}</>,
      }
    ),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  state.weekStart = undefined;
  state.firstVisibleDay = undefined;
  state.period = 'dayGridMonth';
});

describe('phone month drawer', () => {
  it('applies native scroll stops and year keys without closing', () => {
    vi.useFakeTimers();
    render(() => <MonthDrawer month={new Date(2026, 10, 22)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose month' }));
    const month = screen.getByRole('spinbutton', { name: 'Month' });
    month.scrollTop += 44;
    fireEvent.scroll(month);
    expect(state.navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(state.navigate).toHaveBeenLastCalledWith(new Date(2026, 11, 1));
    fireEvent.keyDown(month, { key: 'ArrowUp' });
    expect(state.navigate).toHaveBeenLastCalledWith(new Date(2026, 0, 1));
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Year' }), {
      key: 'ArrowUp',
    });
    expect(state.navigate).toHaveBeenLastCalledWith(new Date(2027, 0, 1));
    expect(screen.getByRole('spinbutton', { name: 'Month' })).toBeTruthy();
  });

  it('opens on the first visible week day and keeps its week position', () => {
    state.period = 'timeGridWeek';
    state.weekStart = new Date(2026, 10, 15);
    render(() => <MonthDrawer month={new Date(2026, 10, 17)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose month' }));
    const month = screen.getByRole('spinbutton', { name: 'Month' });
    fireEvent.keyDown(month, { key: 'Home' });
    fireEvent.keyDown(month, { key: 'ArrowUp' });
    expect(state.navigate).toHaveBeenLastCalledWith(new Date(2026, 1, 15));
  });

  it('labels and opens three days from the first visible day', () => {
    state.period = 'timeGridThreeDay';
    state.firstVisibleDay = new Date(2026, 9, 31);
    render(() => <MonthDrawer month={new Date(2026, 10, 1)} />);
    const trigger = screen.getByRole('button', { name: 'Choose month' });
    expect(trigger.textContent).toBe('October');
    fireEvent.click(trigger);
    expect(
      screen
        .getByRole('spinbutton', { name: 'Month' })
        .getAttribute('aria-valuetext')
    ).toBe('October');
  });

  it('does not open on a hidden weekend from the preceding month', () => {
    state.period = 'timeGridWeek';
    state.weekStart = new Date(2026, 9, 31);
    render(() => (
      <MonthDrawer month={new Date(2026, 9, 31)} showWeekends={false} />
    ));
    const trigger = screen.getByRole('button', { name: 'Choose month' });
    expect(trigger.textContent).toBe('November');
    fireEvent.click(trigger);
    expect(
      screen
        .getByRole('spinbutton', { name: 'Month' })
        .getAttribute('aria-valuetext')
    ).toBe('November');
  });

  it('takes Today through calendar navigation and closes the sheet', () => {
    render(() => <MonthDrawer month={new Date(2026, 10, 22)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(state.today).toHaveBeenCalledOnce();
    expect(screen.queryByRole('spinbutton', { name: 'Month' })).toBeNull();
  });
});
