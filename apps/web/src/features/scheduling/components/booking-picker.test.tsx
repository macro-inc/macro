process.env.TZ = 'UTC';

import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingRejectedError } from '../core/booking-error';
import type { BookingReceipt, PublicEvent, PublicProfile } from '../core/types';
import type { BookingSource } from '../primitives/booking-flow';
import { BookingPicker } from './booking-picker';

// The scheduling project has no SVG loader for the combobox's icons, and the
// time zone picker is not under test here.
vi.mock('@app/features/reminders/TimezoneSelect', () => ({
  TimezoneSelect: (props: { value: string }) => <span>{props.value}</span>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const intro: PublicEvent = {
  id: 'event-intro',
  title: 'Intro call',
  slug: 'intro',
  description: 'A short hello.',
  durationMinutes: 30,
  location: '',
  googleMeet: true,
  questions: [
    { id: 'question-topic', label: 'What should we cover?', required: true },
    { id: 'question-notes', label: 'Anything else?', required: false },
  ],
  requiresConfirmation: false,
  mode: 'individual',
};
const review: PublicEvent = {
  id: 'event-review',
  title: 'Design review',
  slug: 'review',
  description: 'An hour on your designs.',
  durationMinutes: 60,
  location: 'Studio 4',
  googleMeet: false,
  questions: [],
  requiresConfirmation: true,
  mode: 'individual',
};
const profile: PublicProfile = {
  id: 'profile-ada',
  name: 'Ada Lovelace',
  description: 'Analytical engines.',
  eventTypes: [intro, review],
};
const nineAm = {
  startsAt: '2026-10-20T09:00:00Z',
  endsAt: '2026-10-20T09:30:00Z',
};
const receipt: BookingReceipt = {
  booking: {
    id: 'booking-1',
    eventTypeId: 'event-intro',
    title: 'Intro call',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    startsAt: '2026-10-20T09:00:00Z',
    endsAt: '2026-10-20T09:30:00Z',
    timeZone: 'UTC',
    hosts: ['Ada Lovelace'],
    status: 'confirmed',
    attendance: 'unknown',
    rescheduleCount: 0,
    rescheduledAt: null,
    location: 'Google Meet',
    answers: { 'question-topic': 'Compilers' },
  },
  token: 'receipt-token',
  scheduleTimeZone: 'UTC',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const october20 = 'Tuesday, October 20, 2026';
const nineAmLabel = /^9:00\sAM$/;

async function chooseNineAm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: october20 }));
  await user.click(await screen.findByRole('button', { name: nineAmLabel }));
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Grace Hopper');
  await user.type(screen.getByLabelText('Email address'), 'grace@example.com');
  await user.type(
    screen.getByLabelText('What should we cover? *'),
    'Compilers'
  );
}

describe('BookingPicker', () => {
  it('books the chosen time with the attendee details and hands back the receipt', async () => {
    const user = userEvent.setup();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi.fn().mockResolvedValue(receipt),
    };
    const onReceipt = vi.fn();
    render(() => (
      <BookingPicker
        profile={profile}
        event={intro}
        source={source}
        onReceipt={onReceipt}
      />
    ));

    expect(screen.getByText('Intro call')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Sunday, October 4, 2026',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    await chooseNineAm(user);
    expect(source.slots).toHaveBeenCalledWith(
      'profile-ada',
      'event-intro',
      '2026-10-20',
      'UTC'
    );
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    await waitFor(() => expect(onReceipt).toHaveBeenCalledWith(receipt));
    expect(source.book).toHaveBeenCalledWith('profile-ada', 'event-intro', {
      startsAt: '2026-10-20T09:00:00Z',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      timeZone: 'UTC',
      answers: { 'question-topic': 'Compilers' },
      requestId: expect.any(String),
    });
  });

  it('does not book until the required attendee details are filled', async () => {
    const user = userEvent.setup();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi.fn().mockResolvedValue(receipt),
    };
    render(() => (
      <BookingPicker
        profile={profile}
        event={intro}
        source={source}
        onReceipt={vi.fn()}
      />
    ));
    await chooseNineAm(user);

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await user.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await user.type(
      screen.getByLabelText('Email address'),
      'grace@example.com'
    );
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(source.book).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText('What should we cover? *'),
      'Compilers'
    );
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(source.book).toHaveBeenCalledTimes(1));
  });

  it('shows availability loading, and retries after it fails', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ startsAt: string; endsAt: string }[]>();
    const source: BookingSource = {
      slots: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce([nineAm]),
      book: vi.fn(),
    };
    render(() => (
      <BookingPicker
        profile={profile}
        event={intro}
        source={source}
        onReceipt={vi.fn()}
      />
    ));

    await user.click(screen.getByRole('button', { name: october20 }));
    expect(screen.getByRole('status').textContent).toBe('Checking calendars…');
    pending.reject(new Error('offline'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Availability could not be loaded'
    );

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByRole('button', { name: nineAmLabel })
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('locks the details while booking and lets the guest pick another time after a rejection', async () => {
    const user = userEvent.setup();
    const pending = deferred<BookingReceipt>();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi.fn().mockReturnValue(pending.promise),
    };
    render(() => (
      <BookingPicker
        profile={profile}
        event={intro}
        source={source}
        onReceipt={vi.fn()}
      />
    ));
    await chooseNineAm(user);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    const busy = screen.getByRole('button', { name: 'Booking…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(
      true
    );

    pending.reject(new BookingRejectedError('That time was just taken.'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That time was just taken.'
    );
    await user.click(
      screen.getByRole('button', { name: '← Choose another time' })
    );
    expect(
      await screen.findByRole('button', { name: nineAmLabel })
    ).toBeTruthy();
  });

  it('retries the same request after an uncertain response', async () => {
    const user = userEvent.setup();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(receipt),
    };
    const onReceipt = vi.fn();
    render(() => (
      <BookingPicker
        profile={profile}
        event={intro}
        source={source}
        onReceipt={onReceipt}
      />
    ));
    await chooseNineAm(user);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    const check = await screen.findByRole('button', {
      name: 'Check booking status',
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'do not make another booking'
    );
    expect(
      (
        screen.getByRole('button', {
          name: '← Choose another time',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await user.click(check);

    await waitFor(() => expect(onReceipt).toHaveBeenCalledWith(receipt));
    const [first, second] = vi.mocked(source.book).mock.calls;
    expect(second).toEqual(first);
  });

  it('starts over when the event changes, booking only the event on screen', async () => {
    const user = userEvent.setup();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi.fn().mockResolvedValue(receipt),
    };
    const [event, setEvent] = createSignal(intro);
    render(() => (
      <BookingPicker
        profile={profile}
        event={event()}
        source={source}
        onReceipt={vi.fn()}
      />
    ));
    await chooseNineAm(user);
    expect(screen.getByLabelText('Name')).toBeTruthy();

    setEvent(review);
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: nineAmLabel })).toBeNull();
    expect(screen.getByText('Design review')).toBeTruthy();

    await chooseNineAm(user);
    expect(source.slots).toHaveBeenLastCalledWith(
      'profile-ada',
      'event-review',
      '2026-10-20',
      'UTC'
    );
    await user.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await user.type(
      screen.getByLabelText('Email address'),
      'grace@example.com'
    );
    await user.click(screen.getByRole('button', { name: 'Request booking' }));
    await waitFor(() =>
      expect(source.book).toHaveBeenCalledWith(
        'profile-ada',
        'event-review',
        expect.objectContaining({ answers: {} })
      )
    );
  });

  it('keeps an uncertain booking on its own event until it is resolved', async () => {
    const user = userEvent.setup();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi
        .fn()
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce(receipt),
    };
    const onReceipt = vi.fn();
    const [event, setEvent] = createSignal(intro);
    render(() => (
      <BookingPicker
        profile={profile}
        event={event()}
        source={source}
        onReceipt={onReceipt}
      />
    ));
    await chooseNineAm(user);
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await screen.findByRole('button', { name: 'Check booking status' });

    setEvent(review);
    expect(screen.getByText('Intro call')).toBeTruthy();
    expect(screen.queryByText('Design review')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Check booking status' })
    );

    await waitFor(() => expect(onReceipt).toHaveBeenCalledWith(receipt));
    const [first, second] = vi.mocked(source.book).mock.calls;
    expect(second).toEqual(first);
    expect(second?.[1]).toBe('event-intro');
  });

  it('in preview shows real availability but cannot book', async () => {
    const user = userEvent.setup();
    const source: BookingSource = {
      slots: vi.fn().mockResolvedValue([nineAm]),
      book: vi.fn().mockResolvedValue(receipt),
    };
    const onReceipt = vi.fn();
    render(() => (
      <BookingPicker
        profile={profile}
        event={intro}
        source={source}
        onReceipt={onReceipt}
        preview
      />
    ));
    await chooseNineAm(user);
    expect(source.slots).toHaveBeenCalledWith(
      'profile-ada',
      'event-intro',
      '2026-10-20',
      'UTC'
    );
    await fillDetails(user);
    const button = screen.getByRole('button', {
      name: 'Booking is off in preview',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    screen
      .getByRole('button', { name: 'Booking is off in preview' })
      .closest('form')
      ?.requestSubmit();
    await Promise.resolve();
    expect(source.book).not.toHaveBeenCalled();
    expect(onReceipt).not.toHaveBeenCalled();
  });
});
