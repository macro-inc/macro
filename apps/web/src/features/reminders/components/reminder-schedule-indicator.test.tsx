import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ReminderScheduleIndicator } from './reminder-schedule-indicator';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@ui', () => ({
  Tooltip: (props: ParentProps<{ open?: boolean }>) => (
    <div data-testid="tooltip" data-open={String(props.open)}>
      {props.children}
    </div>
  ),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([false, true])(
  'shows keyboard focus schedules on touch=%s',
  (touch) => {
    device.touch = touch;
    render(() => (
      <ReminderScheduleIndicator label="Next: Oct 15" onEdit={() => {}} />
    ));
    const button = screen.getByRole('button');
    vi.spyOn(button, 'matches').mockReturnValue(true);
    fireEvent.focusIn(button);
    expect(screen.getByTestId('tooltip').getAttribute('data-open')).toBe(
      'true'
    );
  }
);
it('keeps a touch-restored focus tooltip from covering the next row action', () => {
  device.touch = true;
  const edit = vi.fn();
  render(() => (
    <ReminderScheduleIndicator label="Next: Oct 15" onEdit={edit} />
  ));
  const button = screen.getByRole('button');
  vi.spyOn(button, 'matches').mockReturnValue(false);
  fireEvent.focusIn(button);
  expect(screen.getByTestId('tooltip').getAttribute('data-open')).toBe('false');
  fireEvent.click(button);
  expect(edit).toHaveBeenCalledOnce();
  fireEvent.focusOut(button);
  fireEvent.focusIn(button);
  expect(screen.getByTestId('tooltip').getAttribute('data-open')).toBe('false');
});
