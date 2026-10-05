import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderForm, type ReminderFormValues } from './ReminderForm';

let originalTimezone: string | undefined;

beforeEach(() => {
  originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';
  vi.stubGlobal('scrollTo', vi.fn());
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

function chooseRepeat(
  value: 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
) {
  const labels = {
    once: 'Does not repeat',
    daily: 'Daily',
    weekdays: 'Weekdays',
    weekly: 'Weekly',
    monthly: 'Monthly',
  } as const;
  fireEvent.keyDown(screen.getByRole('button', { name: /^Repeat,/ }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    screen.getByRole('menuitemradio', { name: labels[value] }),
    { key: 'Enter' }
  );
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
}

describe('one-shot scheduling', () => {
  it('parses natural date language and previews the exact local time without a redundant timezone', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

    fireEvent.input(
      screen.getByPlaceholderText('Try “tomorrow 9am” or “in 30 minutes”'),
      { target: { value: 'in 30 minutes' } }
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /in 30 minutes.*Today, 12:30 PM/,
      })
    );
    const preview = screen.getByText(/Scheduled:/).closest('p');
    expect(preview?.textContent).toContain('12:30 PM');
    expect(preview?.textContent).not.toContain('UTC');
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Follow up',
      schedule: {
        type: 'once',
        remindAt: '2026-09-21T12:30:00.000Z',
      },
    });
  });

  it('treats natural "in 30m" shorthand as minutes, not months', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

    fireEvent.input(
      screen.getByPlaceholderText('Try “tomorrow 9am” or “in 30 minutes”'),
      { target: { value: 'in 30m' } }
    );
    fireEvent.click(
      screen.getByText('in 30m (30 minutes from now)').closest('button')!
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-21T12:30:00.000Z',
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
    expect(inThirty.textContent).toContain('Mon 12:30 PM');
    expect(tomorrow.textContent).toContain('Tue 9:00 AM');

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
    fireEvent.click(screen.getByRole('button', { name: 'Choose date & time' }));

    expect(
      screen.getByLabelText('Custom reminder date').getAttribute('title')
    ).toContain('Sep 21, 2026');
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe(
      '12:30'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-21T12:30:00.000Z',
    });
  });

  it('keeps native validation valid for an exact non-quarter-hour time', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Exact follow up' });

    fireEvent.click(screen.getByRole('button', { name: 'Choose date & time' }));
    const time = screen.getByLabelText('Time') as HTMLInputElement;
    fireEvent.input(time, { target: { value: '14:37:23' } });

    expect(time.step).toBe('1');
    expect(time.form?.checkValidity()).toBe(true);
    (
      screen.getByRole('button', { name: 'Set reminder' }) as HTMLButtonElement
    ).click();

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-22T14:37:23.000Z',
    });
  });

  it('keeps preset seconds valid and exact after opening Custom', () => {
    vi.setSystemTime(new Date('2026-09-21T12:07:23.000Z'));
    const { onSubmit } = renderForm({ initialDescription: 'Exact follow up' });

    fireEvent.click(
      screen.getByRole('button', { name: /In 30m.*12:37:23 PM/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose date & time' }));
    const time = screen.getByLabelText('Time') as HTMLInputElement;

    expect(time.value).toBe('12:37:23');
    expect(time.step).toBe('1');
    expect(time.form?.checkValidity()).toBe(true);
    (
      screen.getByRole('button', { name: 'Set reminder' }) as HTMLButtonElement
    ).click();
    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-21T12:37:23.000Z',
    });
  });

  it('preserves preset seconds when only the Custom date changes', () => {
    vi.setSystemTime(new Date('2026-09-21T12:07:23.000Z'));
    const { onSubmit } = renderForm({ initialDescription: 'Exact follow up' });

    fireEvent.click(
      screen.getByRole('button', { name: /In 30m.*12:37:23 PM/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose date & time' }));
    fireEvent.click(screen.getByLabelText('Custom reminder date'));
    fireEvent.click(screen.getByRole('gridcell', { name: '22' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'once',
      remindAt: '2026-09-22T12:37:23.000Z',
    });
  });

  it('saves a seconds-only edit as a schedule change', () => {
    const original = {
      type: 'once' as const,
      remindAt: '2026-09-22T14:37:23.000Z',
    };
    const { onSubmit } = renderForm({
      initialDescription: 'Exact follow up',
      initialSchedule: original,
      initialRemindAt: original.remindAt,
      submitLabel: 'Save',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose date & time' }));
    fireEvent.input(screen.getByLabelText('Time'), {
      target: { value: '14:37:24' },
    });
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith({
      description: 'Exact follow up',
      schedule: {
        type: 'once',
        remindAt: '2026-09-22T14:37:24.000Z',
      },
    });
  });

  it('invalidates a custom schedule when its time is cleared', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Follow up' });

    fireEvent.click(screen.getByRole('button', { name: 'Choose date & time' }));
    const time = screen.getByLabelText('Time') as HTMLInputElement;
    fireEvent.input(time, { target: { value: '' } });

    expect(time.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Choose a time for this reminder.')).not.toBeNull();
    const submit = screen.getByRole('button', {
      name: 'Set reminder',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    submit.click();
    expect(onSubmit).not.toHaveBeenCalled();
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

  it('keeps the second fall-back-hour instant when confirming the same date', () => {
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

      fireEvent.click(
        screen.getByRole('button', { name: 'Choose date & time' })
      );
      fireEvent.click(screen.getByLabelText('Custom reminder date'));
      fireEvent.click(screen.getByRole('gridcell', { selected: true }));
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

      fireEvent.click(
        screen.getByRole('button', { name: 'Choose date & time' })
      );
      fireEvent.input(screen.getByLabelText('Time'), {
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

      fireEvent.click(
        screen.getByRole('button', { name: 'Choose date & time' })
      );
      expect(
        screen.getByLabelText('Custom reminder date').getAttribute('title')
      ).toContain('Mar 8, 2026');
      expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe(
        '02:30'
      );
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
    ['Daily', 'daily', '0 0 9 * * 1,2,3,4,5,6,7'],
    ['Weekdays', 'weekdays', '0 0 9 * * 2,3,4,5,6'],
  ] as const)(
    'round-trips the %s preset through the existing cron model',
    (_label, value, cron) => {
      const { onSubmit } = renderForm({ initialDescription: 'Standup' });

      chooseRepeat(value);
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

    expect(
      screen.getByRole('button', { name: 'Repeat, Custom schedule' })
    ).not.toBeNull();
    expect(
      screen.getByText(/stays unchanged unless you choose a replacement/)
    ).not.toBeNull();
    const preview = screen.getByText('Next:').closest('p');
    expect(preview?.textContent).toContain('Sep 22, 2026 at 9:00 AM EDT');
    expect(preview?.textContent).toContain('Repeats on a custom schedule');
    expect(preview?.textContent).not.toContain(custom.cron);
    expect(preview?.textContent).not.toContain('America/New_York');
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

    chooseRepeat('weekly');
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

    chooseRepeat('monthly');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 22 * *',
      timezone: 'UTC',
    });
  });

  it('seeds an explicitly chosen Weekly schedule with one weekday', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Weekly review' });

    chooseRepeat('daily');
    chooseRepeat('weekly');
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 * * 3',
      timezone: 'UTC',
    });
  });

  it('keeps Weekly controls visible through preset-equivalent day sets', () => {
    const { onSubmit } = renderForm({ initialDescription: 'Six-day review' });

    chooseRepeat('weekly');
    for (const day of [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]) {
      const button = screen.getByRole('button', { name: day });
      const shouldRepeat = day !== 'Sunday';
      if ((button.getAttribute('aria-pressed') === 'true') !== shouldRepeat) {
        fireEvent.click(button);
      }
    }

    expect(
      screen.getByRole('button', { name: 'Repeat, Weekly' })
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Saturday' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 * * 2,3,4,5,6,7',
      timezone: 'UTC',
    });
  });

  it('seeds an edited Weekly cadence independently from its day shape', () => {
    const { onSubmit } = renderForm({
      initialDescription: 'Existing weekly review',
      initialSchedule: {
        type: 'recurring',
        cron: '0 0 9 * * 3',
        timezone: 'UTC',
      },
      initialRemindAt: '2026-09-22T09:00:00.000Z',
      submitLabel: 'Save',
    });

    for (const day of [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]) {
      const button = screen.getByRole('button', { name: day });
      const shouldRepeat = day !== 'Sunday';
      if ((button.getAttribute('aria-pressed') === 'true') !== shouldRepeat) {
        fireEvent.click(button);
      }
    }

    expect(
      screen.getByRole('button', { name: 'Repeat, Weekly' })
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.calls[0]?.[0].schedule).toEqual({
      type: 'recurring',
      cron: '0 0 9 * * 2,3,4,5,6,7',
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

    fireEvent.input(screen.getByLabelText('Day'), {
      target: { value: '20' },
    });
    fireEvent.input(screen.getByLabelText('At'), {
      target: { value: '16:45' },
    });

    chooseRepeat('weekly');
    expect((screen.getByLabelText('At') as HTMLInputElement).value).toBe(
      '16:45'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thursday' }));

    chooseRepeat('monthly');
    expect((screen.getByLabelText('Day') as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText('At') as HTMLInputElement).value).toBe(
      '16:45'
    );

    chooseRepeat('weekly');
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

it('reverts an edited form in place when its host requests that behavior', () => {
  const { onCancel } = renderForm({
    initialDescription: 'Follow up',
    revertOnCancel: true,
  });
  fireEvent.input(screen.getByLabelText('Reminder description'), {
    target: { value: 'Unsaved edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledWith(true);
  expect(
    (screen.getByLabelText('Reminder description') as HTMLInputElement).value
  ).toBe('Follow up');

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenLastCalledWith(false);
});

it('shows the stored custom monthly occurrence without exposing cron and drops it after replacement', () => {
  renderForm({
    initialDescription: 'Monthly review',
    initialSchedule: {
      type: 'recurring',
      cron: '0 0 9 1,15 * *',
      timezone: 'America/New_York',
    },
    initialRemindAt: '2026-10-15T13:00:00Z',
    submitLabel: 'Save',
  });
  const preview = screen.getByText('Next:').closest('p');
  expect(preview?.textContent).toContain('Oct 15, 2026 at 9:00 AM EDT');
  expect(preview?.textContent).toContain('Repeats monthly on the 1st and 15th');
  expect(preview?.textContent).not.toContain('0 0 9');
  chooseRepeat('daily');
  expect(screen.queryByText('Next:')).toBeNull();
  expect(screen.queryByText(/Oct 15, 2026/)).toBeNull();
  expect(screen.getByText(/Repeats daily at/)).not.toBeNull();
});

it('does not invent a next occurrence when a custom schedule has no nextRunAt', () => {
  renderForm({
    initialDescription: 'Custom review',
    initialSchedule: {
      type: 'recurring',
      cron: '0 */15 9 * * *',
      timezone: 'America/New_York',
    },
    submitLabel: 'Save',
  });
  expect(screen.queryByText('Next:')).toBeNull();
  const preview = screen.getByText('Repeats on a custom schedule').closest('p');
  expect(preview?.textContent).not.toContain('America/New_York');
  expect(preview?.textContent).not.toContain('EDT');
});

it('labels a past custom occurrence as due', () => {
  renderForm({
    initialDescription: 'Past review',
    initialSchedule: {
      type: 'recurring',
      cron: '0 0 9 1,15 * *',
      timezone: 'UTC',
    },
    initialRemindAt: '2026-09-15T09:00:00Z',
    submitLabel: 'Save',
  });
  expect(screen.getByText('Due:').closest('p')?.textContent).toContain(
    'Sep 15, 2026 at 9:00 AM'
  );
  expect(screen.queryByText('Next:')).toBeNull();
});

it('does not apply the opening day seasonal offset to a recurring preview after DST', () => {
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  renderForm({
    initialDescription: 'Sunday review',
    initialSchedule: {
      type: 'recurring',
      cron: '0 0 9 * * 1',
      timezone: 'America/New_York',
    },
    initialRemindAt: '2026-11-01T14:00:00Z',
    submitLabel: 'Save',
  });
  const preview = screen.getByText(/Repeats weekly on Sun at/);
  expect(preview.textContent).toContain('9:00 AM Eastern Time');
  expect(preview.textContent).not.toContain('EDT');
});
