import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailReminderMenu as EmailReminderForm } from '../views/email-reminder-menu';

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
