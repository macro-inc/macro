import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReminderComposerModal } from './ReminderComposerModal';
import {
  closeReminderComposer,
  openStandaloneReminderComposer,
  reminderComposerOpen,
} from './reminder-composer';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  pending: false,
  failure: vi.fn(),
}));
vi.mock('@queries/reminders/reminders', () => ({
  reminderTarget: vi.fn(),
  useCreateReminderMutation: () => ({
    mutateAsync: mocks.save,
    get isPending() {
      return mocks.pending;
    },
  }),
}));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: mocks.failure },
}));
vi.mock('@entity/components/EntitySelectionBadge', () => ({
  EntitySelectionBadge: () => null,
}));
vi.mock('@ui', () => {
  const Slot = (props: ParentProps) => props.children;
  return {
    Dialog: Object.assign(Slot, { Title: Slot, Description: Slot }),
    ActionDialogShell: Object.assign(Slot, {
      Header: Slot,
      Title: Slot,
      Description: Slot,
    }),
  };
});
vi.mock('./ReminderForm', () => ({
  ReminderForm: (props: {
    error?: string;
    onSubmit: (values: unknown) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          props.onSubmit({
            description: 'Follow up',
            schedule: { type: 'once', remind_at: '2099-01-01T09:00:00Z' },
          })
        }
      >
        Submit
      </button>
      <p role="alert">{props.error}</p>
    </div>
  ),
}));
beforeEach(() => {
  mocks.save.mockReset();
  mocks.pending = false;
  mocks.failure.mockClear();
  closeReminderComposer();
});
afterEach(() => {
  cleanup();
  closeReminderComposer();
});
it('retains the failed draft and callback until a successful retry', async () => {
  const onCreated = vi.fn();
  mocks.save
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({});
  openStandaloneReminderComposer({ onCreated });
  render(() => <ReminderComposerModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Please try again')
  );
  expect(reminderComposerOpen()).toBe(true);
  expect(onCreated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(reminderComposerOpen()).toBe(false);
});
it('blocks repeat submission while pending', () => {
  mocks.pending = true;
  openStandaloneReminderComposer();
  render(() => <ReminderComposerModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(mocks.save).not.toHaveBeenCalled();
});
it('does not reopen a saved reminder when the follow-up fails', async () => {
  mocks.save.mockResolvedValueOnce({});
  openStandaloneReminderComposer({
    onCreated: async () => {
      throw new Error('failed');
    },
  });
  render(() => <ReminderComposerModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      'Reminder set, but the item could not be updated'
    )
  );
  expect(reminderComposerOpen()).toBe(false);
  expect(mocks.save).toHaveBeenCalledOnce();
});
