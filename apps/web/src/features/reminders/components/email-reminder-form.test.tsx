import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailReminderMenu as EmailReminderForm } from '../views/email-reminder-menu';

// The browser loader can't run under the test runner; hand over the real
// reader it would load.
vi.mock('@core/natural-time/wasm-module', async () => {
  const { loadNaturalTimeForTest } = await import(
    '@core/natural-time/tests/load-wasm'
  );
  const reader = await loadNaturalTimeForTest();
  return { loadNaturalTimeWasm: async () => reader };
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup(
  overrides: Partial<Parameters<typeof EmailReminderForm>[0]> = {}
) {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(() => (
    <EmailReminderForm
      open={true}
      onOpenChange={onOpenChange}
      subject="A known conversation"
      pending={false}
      onSave={onSave}
      {...overrides}
    />
  ));
  return { onSave, onOpenChange };
}
it('selects a typed time with Enter, defaulting to if no reply', () => {
  const { onSave } = setup();
  expect(screen.queryByLabelText('Reminder description')).toBeNull();
  const input = screen.getByRole('combobox', { name: 'Remind me when' });
  fireEvent.input(input, { target: { value: 'in 30m' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSave).toHaveBeenCalledWith(
    new Date('2026-10-01T12:30:00Z'),
    'if_no_reply'
  );
});
it('previews both readings of a guessed hour and explains unread phrases', async () => {
  setup();
  const input = screen.getByRole('combobox', { name: 'Remind me when' });

  fireEvent.input(input, { target: { value: 'tmrw 8' } });
  const [guess, other] = await screen.findAllByRole('option', {
    name: /^tmrw 8/,
  });
  expect(guess.textContent).toContain('Oct 2, 2026 at 8:00 AM · AM assumed');
  expect(other.textContent).toContain('Oct 2, 2026 at 8:00 PM');

  fireEvent.input(input, { target: { value: 'every friday' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(
    screen.getByText('Repeating reminders aren’t supported.')
  ).toBeTruthy();
});
it('supports arrow-key selection and preserves the condition when editing', () => {
  const { onSave } = setup({
    initialTime: '2026-11-01T06:30:15Z',
    initialCondition: 'regardless',
  });
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSave).toHaveBeenCalledWith(new Date(2026, 9, 1, 17), 'regardless');
});
it('refreshes presets against the current time when the query changes', () => {
  vi.setSystemTime(new Date(2026, 9, 1, 16, 50));
  const { onSave } = setup();
  const input = screen.getByRole('combobox');
  expect(screen.getByRole('option', { name: /Later today/ })).toBeTruthy();

  vi.setSystemTime(new Date(2026, 9, 1, 17, 30));
  fireEvent.input(input, { target: { value: 'later' } });
  expect(screen.queryByRole('option', { name: /Later today/ })).toBeNull();

  fireEvent.input(input, { target: { value: '' } });
  expect(screen.queryByRole('option', { name: /Later today/ })).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSave).toHaveBeenCalledWith(new Date(2026, 9, 1, 18), 'if_no_reply');
});
it('exposes removal separately from selecting a new time', () => {
  const onRemove = vi.fn();
  const { onSave } = setup({ onRemove, initialTime: '2026-11-01T06:30:15Z' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove reminder' }));
  expect(onRemove).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});
it('does not submit while a request is pending', () => {
  const { onSave } = setup({ pending: true });
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(onSave).not.toHaveBeenCalled();
});
it('cancels without saving', () => {
  const { onOpenChange, onSave } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onSave).not.toHaveBeenCalled();
});
