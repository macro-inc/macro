process.env.TZ = 'America/Los_Angeles';

import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublicEvent, PublicProfile } from '../core/types';
import type { BookingSource } from '../primitives/booking-flow';
import { BookingPicker } from './booking-picker';

vi.mock('@app/features/reminders/TimezoneSelect', () => ({
  TimezoneSelect: (props: { value: string }) => <span>{props.value}</span>,
}));

const intro: PublicEvent = {
  id: 'event-intro',
  title: 'Intro call',
  slug: 'intro',
  description: '',
  durationMinutes: 30,
  location: '',
  macroCall: false,
  googleMeet: false,
  questions: [],
  requiresConfirmation: false,
  mode: 'individual',
};
const profile: PublicProfile = {
  id: 'profile-ada',
  name: 'Ada Lovelace',
  description: '',
  eventTypes: [intro],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPicker(slots = vi.fn(async () => [])) {
  const source: BookingSource = { slots, book: vi.fn() };
  render(() => (
    <BookingPicker
      profile={profile}
      event={intro}
      source={source}
      onReceipt={vi.fn()}
    />
  ));
  return slots;
}

it('keeps the next month selectable from a zone behind UTC', async () => {
  vi.setSystemTime(new Date('2026-11-25T15:54:59Z'));
  const user = userEvent.setup();
  const slots = renderPicker();
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
    'America/Los_Angeles'
  );
  expect(screen.getByText('November 2026')).toBeTruthy();
  const dec4 = screen.getByRole('button', {
    name: 'Friday, December 4, 2026',
  }) as HTMLButtonElement;
  expect(dec4.disabled).toBe(false);
  await user.click(dec4);
  expect(slots).toHaveBeenCalledWith(
    'profile-ada',
    'event-intro',
    '2026-12-04',
    'America/Los_Angeles'
  );
});

it('opens on the guest’s month when it is already the next month there', async () => {
  process.env.TZ = 'Asia/Tokyo';
  // 15:30 UTC on Nov 30 is 00:30 on Dec 1 in Tokyo.
  vi.setSystemTime(new Date('2026-11-30T15:30:00Z'));
  const user = userEvent.setup();
  const slots = renderPicker();
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Tokyo');
  expect(screen.getByText('December 2026')).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Monday, November 30, 2026',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  const dec4 = screen.getByRole('button', {
    name: 'Friday, December 4, 2026',
  }) as HTMLButtonElement;
  expect(dec4.disabled).toBe(false);
  await user.click(dec4);
  expect(slots).toHaveBeenCalledWith(
    'profile-ada',
    'event-intro',
    '2026-12-04',
    'Asia/Tokyo'
  );
});
