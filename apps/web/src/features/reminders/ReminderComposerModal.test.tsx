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
  ReminderForm: (props: { onSubmit: (values: unknown) => void }) => (
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
it('dismisses before saving and calls the captured handler after success', async () => {
  let resolve!: (value: object) => void;
  mocks.save.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const onCreated = vi.fn();
  openStandaloneReminderComposer({ onCreated });
  render(() => <ReminderComposerModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(reminderComposerOpen()).toBe(false);
  expect(onCreated).not.toHaveBeenCalled();
  resolve({});
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
});
it('reports a failed save by toast without reopening or calling the handler', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'));
  const onCreated = vi.fn();
  openStandaloneReminderComposer({ onCreated });
  render(() => <ReminderComposerModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith('Failed to create reminder')
  );
  expect(reminderComposerOpen()).toBe(false);
  expect(onCreated).not.toHaveBeenCalled();
});
