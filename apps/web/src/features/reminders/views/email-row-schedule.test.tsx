import type { ReminderEntity } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps, Show } from 'solid-js';
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
  ReminderDetails: (props: {
    reminderId: string;
    isEmailFollowup: boolean;
    onClose: () => void;
  }) => (
    <Show when={props.reminderId} keyed>
      {(id) => (
        <div data-editor-id={id} data-editor-email={props.isEmailFollowup}>
          <input aria-label="Unsaved note" value={id} />
          <button onClick={props.onClose}>Cancel</button>
        </div>
      )}
    </Show>
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

it('pins the editing target and unsaved draft through same-ID and nearest A-to-B summary refreshes', () => {
  const first: ReminderEntity = {
    type: 'reminder',
    id: 'A',
    name: 'A',
    description: 'A',
    ownerId: 'owner',
    enabled: true,
    scheduleType: 'once',
    nextRunAt: '2026-10-02T12:00:00Z',
  };
  const [nearest, setNearest] = createSignal(first);
  render(() => (
    <EmailRowSchedule reminder={{ nearest: nearest(), count: 2 }} />
  ));
  fireEvent.click(screen.getByRole('button', { name: /Remind me:/ }));
  const note = screen.getByRole('textbox', {
    name: 'Unsaved note',
  }) as HTMLInputElement;
  fireEvent.input(note, { target: { value: 'Keep my draft' } });
  setNearest({ ...first, nextRunAt: '2026-10-03T12:00:00Z' });
  expect(screen.getByRole('textbox', { name: 'Unsaved note' })).toBe(note);
  expect(note.value).toBe('Keep my draft');
  setNearest({
    ...first,
    id: 'B',
    emailFollowup: {
      state: 'pending',
      condition: 'if_no_reply',
      threadId: 'thread',
      reminderId: 'B',
      revision: 'revision',
      linkId: 'inbox',
      remindAt: '2026-10-02T12:00:00Z',
    },
  });
  expect(document.querySelector('[data-editor-id="A"]')).toBeTruthy();
  expect(document.querySelector('[data-editor-id="B"]')).toBeNull();
  expect(document.querySelector('[data-editor-email="false"]')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'Unsaved note' })).toBe(note);
  expect(note.value).toBe('Keep my draft');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: /Returning:/ }));
  expect(
    document.querySelector('[data-editor-id="B"][data-editor-email="true"]')
  ).toBeTruthy();
});
