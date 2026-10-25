import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RescheduleForm } from './reschedule-form';

vi.mock('./TimezoneSelect', () => ({
  TimezoneSelect: (props: {
    value: string;
    onChange: (zone: string) => void;
  }) => (
    <select
      aria-label="Your time zone"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      <option value="UTC">UTC</option>
      <option value="Asia/Tokyo">Asia/Tokyo</option>
    </select>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('loads the selected local date and zone and submits the returned instant', async () => {
  const user = userEvent.setup();
  const load = vi.fn(async () => [
    {
      startsAt: '2026-10-19T16:00:00Z',
      endsAt: '2026-10-19T16:30:00Z',
    },
  ]);
  const submit = vi.fn(async () => {});
  render(() => (
    <RescheduleForm load={load} submit={submit} onCancel={() => {}} />
  ));
  await user.selectOptions(
    screen.getByLabelText('Your time zone'),
    'Asia/Tokyo'
  );
  await user.click(screen.getByRole('button', { name: 'Date' }));
  await user.click(screen.getByRole('gridcell', { name: '20' }));
  expect(load).toHaveBeenCalledWith('2026-10-20', 'Asia/Tokyo');
  expect(
    screen.getByRole('button', { name: /^Time Time / }).textContent
  ).toMatch(/1:00\sAM/);
  await user.click(screen.getByRole('button', { name: 'Confirm new time' }));
  expect(submit).toHaveBeenCalledWith('2026-10-19T16:00:00Z');
});

it.each(['success', 'error'])(
  'ignores a pending %s after the zone changes',
  async (outcome) => {
    const user = userEvent.setup();
    let finish!: () => void;
    const pending = new Promise<{ startsAt: string; endsAt: string }[]>(
      (resolve, reject) => {
        finish = () =>
          outcome === 'success'
            ? resolve([
                {
                  startsAt: '2026-10-20T16:00:00Z',
                  endsAt: '2026-10-20T16:30:00Z',
                },
              ])
            : reject(new Error('Unavailable'));
      }
    );
    const load = vi.fn(() => pending);
    const submit = vi.fn(async () => {});
    const { container } = render(() => (
      <RescheduleForm load={load} submit={submit} onCancel={() => {}} />
    ));
    await user.click(screen.getByRole('button', { name: 'Date' }));
    await user.click(screen.getByRole('gridcell', { name: '20' }));
    expect(screen.getByRole('status').textContent).toContain(
      'Checking availability'
    );
    await user.selectOptions(
      screen.getByLabelText('Your time zone'),
      'Asia/Tokyo'
    );
    expect(screen.queryByRole('status')).toBeNull();
    finish();
    await Promise.allSettled([pending]);
    expect(
      container.querySelector<HTMLInputElement>('input[type="date"]')?.value
    ).toBe('');
    expect(screen.queryByRole('button', { name: /^Time Time / })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Confirm new time',
    });
    expect(confirm.disabled).toBe(true);
    await user.click(confirm);
    expect(submit).not.toHaveBeenCalled();
  }
);
