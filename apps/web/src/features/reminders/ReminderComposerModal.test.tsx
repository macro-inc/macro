import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReminderComposerModal } from './ReminderComposerModal';
import {
  closeReminderComposer,
  openStandaloneReminderComposer,
  reminderComposerOpen,
} from './reminder-composer';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@queries/reminders/reminders', () => ({
  reminderTarget: vi.fn(),
  useCreateReminderMutation: () => ({ mutateAsync: mocks.save }),
}));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('../../lib/signals/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: vi.fn() },
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
    pending?: boolean;
    error?: string;
    onSubmit: (values: {
      description: string;
      schedule: { type: 'once'; remindAt: string };
    }) => void;
  }) => {
    const [description, setDescription] = createSignal('Follow up');
    return (
      <form
        aria-label="Reminder form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit({
            description: description(),
            schedule: { type: 'once', remindAt: '2099-01-01T09:00:00Z' },
          });
        }}
      >
        <input
          aria-label="Reminder description"
          value={description()}
          disabled={props.pending}
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
        <button type="submit" disabled={props.pending}>
          Submit
        </button>
        <Show when={props.error}>
          <div role="alert">{props.error}</div>
        </Show>
      </form>
    );
  },
}));

function savedReminder() {
  return {
    id: 'reminder-1',
    schedule: { type: 'once', remindAt: '2099-01-01T09:00:00Z' },
  };
}

beforeEach(() => {
  mocks.save.mockReset();
  mocks.success.mockReset();
  closeReminderComposer();
});

afterEach(() => {
  cleanup();
  closeReminderComposer();
});

it('keeps the draft open and prevents concurrent duplicate submits', async () => {
  let rejectRequest!: (reason: Error) => void;
  mocks.save.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectRequest = reject;
    })
  );
  const onCreated = vi.fn();
  openStandaloneReminderComposer({ onCreated });
  render(() => <ReminderComposerModal />);

  const input = screen.getByRole('textbox', {
    name: 'Reminder description',
  });
  fireEvent.input(input, { target: { value: 'Keep this draft' } });
  input.focus();
  const form = screen.getByRole('form', { name: 'Reminder form' });
  fireEvent.submit(form);
  fireEvent.submit(form);

  expect(mocks.save).toHaveBeenCalledOnce();
  expect(reminderComposerOpen()).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect((input as HTMLInputElement).disabled).toBe(true);

  rejectRequest(new Error('offline'));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('Your draft is still here');
  expect(error.textContent).toContain('may already exist');
  expect((input as HTMLInputElement).value).toBe('Keep this draft');
  expect((input as HTMLInputElement).disabled).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(reminderComposerOpen()).toBe(true);
  expect(onCreated).not.toHaveBeenCalled();
});

it('retries a rejected mutation with the same draft and closes only on success', async () => {
  mocks.save
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(savedReminder());
  const onCreated = vi.fn();
  openStandaloneReminderComposer({ onCreated });
  render(() => <ReminderComposerModal />);

  const input = screen.getByRole('textbox', {
    name: 'Reminder description',
  });
  fireEvent.input(input, { target: { value: 'Retry this reminder' } });
  const form = screen.getByRole('form', { name: 'Reminder form' });
  fireEvent.submit(form);
  await screen.findByRole('alert');

  fireEvent.submit(form);
  await waitFor(() => expect(reminderComposerOpen()).toBe(false));

  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({
    description: 'Retry this reminder',
  });
  expect(onCreated).toHaveBeenCalledOnce();
  expect(mocks.success).toHaveBeenCalledWith(
    expect.stringContaining('Reminder set ·'),
    expect.objectContaining({
      actions: [expect.objectContaining({ label: 'View' })],
    })
  );
});

it('waits for a deferred mutation before closing and running the follow-up', async () => {
  let resolveRequest!: (value: ReturnType<typeof savedReminder>) => void;
  mocks.save.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveRequest = resolve;
    })
  );
  const onCreated = vi.fn();
  openStandaloneReminderComposer({ onCreated });
  render(() => <ReminderComposerModal />);

  fireEvent.submit(screen.getByRole('form', { name: 'Reminder form' }));
  expect(reminderComposerOpen()).toBe(true);
  expect(onCreated).not.toHaveBeenCalled();

  resolveRequest(savedReminder());
  await waitFor(() => expect(reminderComposerOpen()).toBe(false));
  expect(onCreated).toHaveBeenCalledOnce();
});
