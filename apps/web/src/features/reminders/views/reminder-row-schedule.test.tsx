import type { ReminderEntity } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ReminderRowSchedule } from './reminder-row-schedule';

vi.mock('@ui', () => {
  const Container = (props: ParentProps) => <>{props.children}</>;
  return {
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
  fireEvent.click(screen.getByRole('button', { name: /Scheduled:/ }));
  expect(openSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(openSource).not.toHaveBeenCalled();
});
