import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailReminderForm } from './email-reminder-form';

beforeEach(() => {
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
  const onCancel = vi.fn();
  render(() => (
    <EmailReminderForm
      subject="A known conversation"
      pending={false}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />
  ));
  return { onSave, onCancel };
}
describe('email reminder time-first form', () => {
  it('uses the known subject, defaults to no reply and parses a relative time', () => {
    const { onSave } = setup();
    expect(screen.queryByLabelText('Reminder description')).toBeNull();
    fireEvent.input(screen.getByLabelText('When'), {
      target: { value: 'in 30m' },
    });
    fireEvent.submit(screen.getByLabelText('When').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(
      new Date('2026-10-01T12:30:00Z'),
      'if_no_reply'
    );
  });
  it('preserves the existing instant on an untouched edit and exposes removal', () => {
    const onRemove = vi.fn();
    const { onSave } = setup({
      initialTime: '2026-11-01T06:30:15Z',
      initialCondition: 'regardless',
      onRemove,
    });
    fireEvent.submit(screen.getByLabelText('When').closest('form')!);
    expect(onSave).toHaveBeenCalledWith(
      new Date('2026-11-01T06:30:15Z'),
      'regardless'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
  it('keeps invalid and pending submissions from writing', () => {
    const { onSave } = setup({ pending: true });
    fireEvent.submit(screen.getByLabelText('When').closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
  });
  it('cancel never submits', () => {
    const { onCancel, onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
