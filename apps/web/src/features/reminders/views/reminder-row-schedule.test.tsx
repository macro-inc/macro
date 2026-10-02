import type { ReminderEntity } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ReminderRowSchedule } from './reminder-row-schedule';

vi.mock('@ui', async (importOriginal) => {
  const { cn } = await importOriginal<typeof import('@ui')>();
  const Container = (props: ParentProps) => <>{props.children}</>;
  return {
    cn,
    Button: (
      props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
    ) => <button {...props} aria-label={props['aria-label'] ?? props.label} />,
    Tooltip: Container,
    Dialog: (props: ParentProps<{ open: boolean }>) => (
      <Portal>{props.open && props.children}</Portal>
    ),
    ActionDialogShell: Object.assign(Container, {
      Header: Container,
      Title: Container,
    }),
  };
});
vi.mock('../ReminderEditorSplit', () => ({
  ReminderDetails: (props: { onClose: () => void }) => (
    <button onClick={props.onClose}>Cancel</button>
  ),
}));
vi.mock('../primitives/reminder-clock', () => ({
  useReminderClock: () => () => Date.parse('2026-10-01T12:00:00Z'),
}));
afterEach(cleanup);

it('isolates portaled editor clicks from the source row', () => {
  const openSource = vi.fn();
  const entity: ReminderEntity = {
    type: 'reminder',
    id: 'reminder',
    name: 'Review',
    description: 'Review',
    ownerId: '',
    enabled: true,
    scheduleType: 'once',
    nextRunAt: '2026-10-02T12:00:00Z',
  };
  render(() => (
    <div onClick={openSource}>
      <ReminderRowSchedule entity={entity} />
    </div>
  ));
  fireEvent.click(screen.getByRole('button', { name: /Remind me:/ }));
  expect(openSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(openSource).not.toHaveBeenCalled();
});

const recurring: ReminderEntity = {
  type: 'reminder',
  id: 'recurring',
  name: 'Review',
  description: 'Review',
  ownerId: '',
  enabled: true,
  scheduleType: 'recurring',
  cron: '0 0 9 1,15 * *',
  timezone: 'UTC',
  nextRunAt: '2026-10-15T09:00:00Z',
  completedAt: '2026-10-01T10:00:00Z',
};
it('keeps a completed recurring clock and exposes undo without a pressed-state pill', async () => {
  const toggle = vi.fn().mockResolvedValue(undefined);
  render(() => (
    <ReminderRowSchedule entity={recurring} onToggleDone={toggle} />
  ));
  const undo = screen.getByRole('button', { name: 'Mark reminder not done' });
  expect(undo.hasAttribute('aria-pressed')).toBe(false);
  expect(
    screen.getByRole('button', { name: /Next:.*Repeats monthly/ })
  ).toBeTruthy();
  fireEvent.click(undo);
  await waitFor(() => expect(toggle).toHaveBeenCalledOnce());
});
it('disables repeat completion while pending and recovers after failure', async () => {
  let reject: (reason: Error) => void = () => {};
  const toggle = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      })
  );
  render(() => (
    <ReminderRowSchedule
      entity={{ ...recurring, completedAt: undefined }}
      onToggleDone={toggle}
    />
  ));
  const done = screen.getByRole('button', {
    name: 'Mark reminder done',
  }) as HTMLButtonElement;
  fireEvent.click(done);
  expect(done.disabled).toBe(true);
  fireEvent.click(done);
  expect(toggle).toHaveBeenCalledOnce();
  reject(new Error('offline'));
  await waitFor(() => expect(done.disabled).toBe(false));
});
it('opens the owning composer for a completed email mirror instead of reopening generically', () => {
  const toggle = vi.fn();
  const emailFollowup: NonNullable<ReminderEntity['emailFollowup']> = {
    threadId: 'thread',
    linkId: 'link',
    reminderId: 'recurring',
    revision: 'revision',
    condition: 'if_no_reply',
    state: 'returned',
    remindAt: '2026-10-15T09:00:00Z',
  };
  render(() => (
    <ReminderRowSchedule
      entity={{ ...recurring, scheduleType: 'once', emailFollowup }}
      onToggleDone={toggle}
    />
  ));
  fireEvent.click(
    screen.getByRole('button', { name: 'Done — remind me again' })
  );
  expect(toggle).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Next:/ })).toBeNull();
});
