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
import { EmailRowSchedule } from './email-row-schedule';

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

it('keeps the email row and its completion independent from the clock editor', async () => {
  const openThread = vi.fn();
  const rowKey = vi.fn();
  const nearest: ReminderEntity = {
    type: 'reminder',
    id: 'r',
    name: 'Reply',
    description: 'Reply',
    ownerId: 'owner',
    enabled: true,
    scheduleType: 'once',
    nextRunAt: '2026-10-02T12:00:00Z',
  };
  render(() => (
    <div onClick={openThread} onKeyDown={rowKey}>
      <EmailRowSchedule reminder={{ nearest, count: 3 }} />
    </div>
  ));
  const clock = screen.getByRole('button', {
    name: /Remind me:.*2 more reminders/,
  });
  expect(clock.tagName).toBe('BUTTON');
  expect(screen.queryByRole('button', { name: /Mark.*done/ })).toBeNull();
  fireEvent.keyDown(clock, { key: 'Enter' });
  expect(rowKey).not.toHaveBeenCalled();
  fireEvent.pointerDown(clock);
  fireEvent.click(clock);
  expect(openThread).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  );
  expect(openThread).not.toHaveBeenCalled();
});
