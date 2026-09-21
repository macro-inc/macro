import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderForm, type ReminderFormValues } from './ReminderForm';

let originalTimezone: string | undefined;

beforeEach(() => {
  originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function renderForm(
  overrides: Partial<Parameters<typeof ReminderForm>[0]> = {}
) {
  const onSubmit = vi.fn<(values: ReminderFormValues) => void>();
  const onCancel = vi.fn();
  render(() => (
    <ReminderForm
      layout="inline"
      placeholder="What's the reminder?"
      submitLabel="Set reminder"
      onCancel={onCancel}
      onSubmit={onSubmit}
      {...overrides}
    />
  ));
  return { onSubmit, onCancel };
}

describe('one-shot scheduling', () => {
  it('parses natural date language and previews the exact timezone', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

    fireEvent.input(
      screen.getByPlaceholderText('Try “tomorrow 9am” or “in 30 minutes”'),
      { target: { value: 'in 30 minutes' } }
    );

    const preview = screen.getByText(/Scheduled:/).closest('p');
    expect(preview?.textContent).toContain('12:30 PM');
    expect(preview?.textContent).toMatch(/\([A-Z]+\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Follow up',
      schedule: {
        type: 'once',
        remindAt: '2026-09-21T12:30:00.000Z',
      },
    });
  });

  it('offers quick presets with their actual resolved times', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

    const inThirty = screen.getByRole('button', {
      name: /In 30m.*12:30 PM/,
    });
    const tomorrow = screen.getByRole('button', {
      name: /Tomorrow.*Sep 22.*9:00 AM/,
    });
    expect(inThirty).not.toBeNull();
    expect(tomorrow).not.toBeNull();

    fireEvent.click(inThirty);
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-21T12:30:00.000Z',
    });
  });

  it('carries a typed instant into Custom instead of restoring the default', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

    fireEvent.input(
      screen.getByPlaceholderText('Try “tomorrow 9am” or “in 30 minutes”'),
      { target: { value: 'in 30 minutes' } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));

    expect(
      (screen.getByLabelText('Custom reminder date') as HTMLInputElement).value
    ).toBe('2026-09-21');
    expect(
      (screen.getByLabelText('Custom reminder time') as HTMLInputElement).value
    ).toBe('12:30');
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-21T12:30:00.000Z',
    });
  });

  it('preserves an overdue schedule for a description-only edit', () => {
    const overdue = {
      type: 'once' as const,
      remindAt: '2026-09-20T09:00:00.000Z',
    };
    const { onSubmit } = renderForm({
      initialDescription: 'Old title',
      initialSchedule: overdue,
      initialRemindAt: overdue.remindAt,
      submitLabel: 'Save',
    });

    fireEvent.input(screen.getByLabelText('Reminder description'), {
      target: { value: 'New title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({
      description: 'New title',
      schedule: overdue,
    });
  });

  it('preserves the selected instant when In 30m crosses the fall-back fold', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      vi.setSystemTime(new Date('2026-11-01T01:45:00-04:00'));
      const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

      fireEvent.click(screen.getByRole('button', { name: /In 30m/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

      expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
        type: 'once',
        remindAt: '2026-11-01T06:15:00.000Z',
      });
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('keeps the second fall-back-hour instant on a description-only edit', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      vi.setSystemTime(new Date('2026-10-31T12:00:00-04:00'));
      const secondFold = {
        type: 'once' as const,
        remindAt: '2026-11-01T06:30:00.000Z',
      };
      const { onSubmit } = renderForm({
        initialDescription: 'Before the clocks change',
        initialSchedule: secondFold,
        initialRemindAt: secondFold.remindAt,
        submitLabel: 'Save',
      });

      fireEvent.input(screen.getByLabelText('Reminder description'), {
        target: { value: 'After the clocks change' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onSubmit).toHaveBeenCalledWith({
        description: 'After the clocks change',
        schedule: secondFold,
      });
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('rejects a custom local time skipped by spring-forward', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      vi.setSystemTime(new Date('2026-03-07T12:00:00-05:00'));
      const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

      fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
      fireEvent.input(screen.getByLabelText('Custom reminder date'), {
        target: { value: '2026-03-08' },
      });
      fireEvent.input(screen.getByLabelText('Custom reminder time'), {
        target: { value: '02:30' },
      });

      expect(
        screen.getByText(/local time doesn’t exist because the clocks change/)
      ).not.toBeNull();
      const submit = screen.getByRole('button', { name: 'Set reminder' });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submit);
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('rejects a date-language time skipped by spring-forward', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      vi.setSystemTime(new Date('2026-03-07T12:00:00-05:00'));
      const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

      fireEvent.input(
        screen.getByPlaceholderText('Try “tomorrow 9am” or “in 30 minutes”'),
        { target: { value: 'Mar 8 2026 2:30am' } }
      );

      expect(
        screen.getByText(/local time doesn’t exist because the clocks change/)
      ).not.toBeNull();
      expect(
        (
          screen.getByRole('button', {
            name: 'Set reminder',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
      expect(
        (screen.getByLabelText('Custom reminder date') as HTMLInputElement)
          .value
      ).toBe('2026-03-08');
      expect(
        (screen.getByLabelText('Custom reminder time') as HTMLInputElement)
          .value
      ).toBe('02:30');
      expect(
        screen.getByText(/local time doesn’t exist because the clocks change/)
      ).not.toBeNull();
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });
});

describe('recurrence', () => {
  it.each([
    ['Daily', '0 0 9 * * 1,2,3,4,5,6,7'],
    ['Weekdays', '0 0 9 * * 2,3,4,5,6'],
  ])(
    'round-trips the %s preset through the existing cron model',
    (label, cron) => {
      const { onSubmit } = renderForm({ initialDescription: 'Standup' });

      fireEvent.click(screen.getByText('Repeat'));
      fireEvent.click(screen.getByRole('button', { name: label }));
      fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

      expect(onSubmit.mock.calls[0]?.[0].schedule).toMatchObject({
        type: 'recurring',
        cron,
      });
    }
  );

  it('keeps an unsupported stored cron verbatim on a description-only edit', () => {
    const custom = {
      type: 'recurring' as const,
      cron: '0 */15 9 * * *',
      timezone: 'America/New_York',
    };
    const { onSubmit } = renderForm({
      initialDescription: 'Custom cadence',
      initialSchedule: custom,
      initialRemindAt: '2026-09-22T13:00:00.000Z',
      submitLabel: 'Save',
    });

    expect(screen.getByText('Custom schedule')).not.toBeNull();
    expect(
      screen.getByText(/will stay unchanged unless you choose a replacement/)
    ).not.toBeNull();
    fireEvent.input(screen.getByLabelText('Reminder description'), {
      target: { value: 'Renamed custom cadence' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Renamed custom cadence',
      schedule: custom,
    });
  });

  it('seeds Weekly from the selected monthly occurrence', () => {
    const { onSubmit } = renderForm({
      initialDescription: 'Monthly review',
      initialSchedule: {
        type: 'recurring',
        cron: '0 30 14 15 * *',
        timezone: 'UTC',
      },
      initialRemindAt: '2026-10-15T14:30:00.000Z',
      submitLabel: 'Save',
    });

    fireEvent.click(screen.getByText('Repeat'));
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 30 14 * * 5',
      timezone: 'UTC',
    });
  });

  it('seeds Monthly from the selected weekly occurrence', () => {
    const { onSubmit } = renderForm({
      initialDescription: 'Weekly review',
      initialSchedule: {
        type: 'recurring',
        cron: '0 0 9 * * 2,3,4,5,6',
        timezone: 'UTC',
      },
      initialRemindAt: '2026-09-22T09:00:00.000Z',
      submitLabel: 'Save',
    });

    fireEvent.click(screen.getByText('Repeat'));
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 22 * *',
      timezone: 'UTC',
    });
  });

  it('seeds an explicitly chosen Weekly schedule with one weekday', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Weekly review' });

    fireEvent.click(screen.getByText('Repeat'));
    fireEvent.click(screen.getByRole('button', { name: 'Daily' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 * * 3',
      timezone: 'UTC',
    });
  });

  it('keeps edited time and cadence-specific days while switching repeat shapes', () => {
    const { onSubmit } = renderForm({
      initialDescription: 'Monthly review',
      initialSchedule: {
        type: 'recurring',
        cron: '0 30 14 15 * *',
        timezone: 'UTC',
      },
      initialRemindAt: '2026-10-15T14:30:00.000Z',
      submitLabel: 'Save',
    });

    fireEvent.click(screen.getByText('Repeat'));
    fireEvent.input(screen.getByLabelText('Day'), {
      target: { value: '20' },
    });
    fireEvent.input(screen.getByLabelText('At'), {
      target: { value: '16:45' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect((screen.getByLabelText('At') as HTMLInputElement).value).toBe(
      '16:45'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thursday' }));

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect((screen.getByLabelText('Day') as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText('At') as HTMLInputElement).value).toBe(
      '16:45'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(
      screen
        .getByRole('button', { name: 'Friday' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'Thursday' })
        .getAttribute('aria-pressed')
    ).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 45 16 * * 6',
      timezone: 'UTC',
    });
  });
});

it('uses predictable Cancel behavior', () => {
  const { onCancel } = renderForm({ initialDescription: 'Follow up' });
  fireEvent.input(screen.getByLabelText('Reminder description'), {
    target: { value: 'Unsaved edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledOnce();
});
