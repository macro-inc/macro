import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { BookingLinkArgs } from '../core/booking-link';
import { newEventType, newSchedule } from '../core/types';
import { BookingLinkDraftComposer } from './booking-link-draft-composer';

afterEach(cleanup);
function fixture(execute = vi.fn(async (_args: BookingLinkArgs) => true)) {
  const schedule = newSchedule('America/New_York');
  const event = {
    ...newEventType(schedule.id, ['macro|host@example.com'], false),
    title: 'Intro',
    slug: 'intro',
  };
  const reject = vi.fn(async () => true);
  render(() => (
    <BookingLinkDraftComposer
      initialData={{ draft: { event, schedule } }}
      members={[]}
      sink={{
        canAct: () => true,
        lockedNotice: () => undefined,
        onExecute: execute,
        onReject: reject,
      }}
    />
  ));
  return { execute, reject };
}
it('submits edited details and hours together exactly once', async () => {
  const { execute } = fixture();
  fireEvent.input(screen.getByLabelText('Title'), {
    target: { value: 'Discovery' },
  });
  fireEvent.input(screen.getByLabelText('Monday start 1'), {
    target: { value: '10:00' },
  });
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Create booking link' })[0]
  );
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0][0].draft.event.title).toBe('Discovery');
  expect(
    execute.mock.calls[0][0].draft.schedule.weekly[1].windows[0].start
  ).toBe('10:00');
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Create booking link' })[0]
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it('cancels without executing the draft', async () => {
  const { execute, reject } = fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(reject).toHaveBeenCalledTimes(1));
  expect(execute).not.toHaveBeenCalled();
});
it('keeps the edited draft usable after an execution failure', async () => {
  const execute = vi.fn(async () => {
    throw new Error('Configuration changed. Refresh and try again.');
  });
  fixture(execute);
  fireEvent.input(screen.getByLabelText('Title'), {
    target: { value: 'Retained edit' },
  });
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Create booking link' })[0]
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Configuration changed'
  );
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
    'Retained edit'
  );
});

it('allows an identical create retry even when the saved slug is already listed', async () => {
  const schedule = newSchedule('UTC');
  const event = {
    ...newEventType(schedule.id, ['macro|host@example.com'], false),
    title: 'Intro',
    slug: 'intro',
  };
  const execute = vi.fn(async (_args: BookingLinkArgs) => true);
  render(() => (
    <BookingLinkDraftComposer
      initialData={{ draft: { event, schedule } }}
      members={[]}
      events={[event]}
      sink={{
        canAct: () => true,
        lockedNotice: () => undefined,
        onExecute: execute,
        onReject: async () => true,
      }}
    />
  ));
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Create booking link' })[0]
  );
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
});
it('lets the user repair incomplete availability and its name in the review', async () => {
  const schedule = { ...newSchedule('UTC'), name: '', weekly: [] };
  const event = {
    ...newEventType(schedule.id, ['macro|host@example.com'], false),
    title: 'Intro',
    slug: 'intro',
  };
  const execute = vi.fn(async (_args: BookingLinkArgs) => true);
  render(() => (
    <BookingLinkDraftComposer
      initialData={{ draft: { event, schedule } }}
      members={[]}
      sink={{
        canAct: () => true,
        lockedNotice: () => undefined,
        onExecute: execute,
        onReject: async () => true,
      }}
    />
  ));
  fireEvent.input(screen.getByLabelText('Availability name'), {
    target: { value: 'Repaired hours' },
  });
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Create booking link' })[0]
  );
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute.mock.calls[0][0].draft.schedule.weekly).toHaveLength(7);
  expect(execute.mock.calls[0][0].draft.schedule.name).toBe('Repaired hours');
});
