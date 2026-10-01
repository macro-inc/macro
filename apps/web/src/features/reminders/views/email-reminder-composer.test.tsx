import type { EntityData } from '@entity';
import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailReminderComposer } from './email-reminder-composer';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  pushUndo: vi.fn(),
  takeHandler: vi.fn(),
  navigate: vi.fn(),
  close: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@queries/reminders/email-followup', () => ({
  executeEmailFollowup: mocks.execute,
  useEmailFollowupQuery: mocks.query,
}));
vi.mock('@queries/undo', () => ({
  useMutationUndoContext: () => ({ pushUndo: mocks.pushUndo }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('../reminder-composer', () => ({
  closeReminderComposer: mocks.close,
  takeReminderCreatedHandler: mocks.takeHandler,
}));
vi.mock('../components/email-reminder-form', () => ({
  EmailReminderForm: (props: {
    onSave: (at: Date, condition: 'if_no_reply') => void;
    onRemove?: () => void;
    pending: boolean;
  }) => (
    <>
      <button
        disabled={props.pending}
        onClick={() =>
          props.onSave(new Date('2026-12-01T12:00:00Z'), 'if_no_reply')
        }
      >
        Save
      </button>
      <button onClick={props.onRemove}>Remove</button>
    </>
  ),
}));
vi.mock('@ui', () => ({
  ActionDialogShell: {
    Body: () => null,
    Header: () => null,
    Title: () => null,
    Description: () => null,
  },
  Button: () => null,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pushUndo.mockReturnValue({ undo: vi.fn() });
});
afterEach(cleanup);
it('keeps initial navigation and removal undo when a lost response is discovered before retry', async () => {
  const [current, setCurrent] = createSignal<EmailFollowup | null>(null);
  mocks.query.mockReturnValue({
    isSuccess: true,
    get data() {
      return current();
    },
  });
  mocks.takeHandler.mockReturnValueOnce(mocks.navigate);
  mocks.execute.mockRejectedValueOnce(new Error('Response lost'));
  render(() => (
    <EmailReminderComposer
      entity={{ id: 'thread', type: 'email', name: 'Subject' } as EntityData}
      onPending={() => {}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')
    ).toBe(false)
  );
  const saved: EmailFollowup = {
    condition: 'if_no_reply',
    linkId: 'inbox',
    remindAt: '2026-12-01T12:00:00.000Z',
    reminderId: 'reminder',
    revision: mocks.execute.mock.calls[0][1].operationId,
    state: 'pending',
    threadId: 'thread',
  };
  setCurrent(saved);
  mocks.execute.mockImplementationOnce(async (_thread, _command, after) => {
    await after(saved);
    return saved;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.pushUndo).toHaveBeenCalledOnce());
  expect(mocks.execute.mock.calls[1][1].operationId).toBe(
    mocks.execute.mock.calls[0][1].operationId
  );
  expect(mocks.navigate).toHaveBeenCalledOnce();
  await mocks.pushUndo.mock.calls[0][0].undo();
  expect(mocks.execute).toHaveBeenLastCalledWith(
    'thread',
    expect.objectContaining({
      type: 'remove',
      expectedRevision: saved.revision,
      undo: true,
    })
  );
});

it('undoes removal by scheduling the captured time and condition again', async () => {
  const previous: EmailFollowup = {
    condition: 'regardless',
    linkId: 'inbox',
    remindAt: '2026-12-01T12:00:00.000Z',
    reminderId: 'reminder',
    revision: 'original',
    state: 'pending',
    threadId: 'thread',
  };
  mocks.query.mockReturnValue({ isSuccess: true, data: previous });
  mocks.execute.mockResolvedValueOnce({
    ...previous,
    revision: 'removed',
    state: 'removed',
  });
  render(() => (
    <EmailReminderComposer
      entity={{ id: 'thread', type: 'email', name: 'Subject' } as EntityData}
      onPending={() => {}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(mocks.pushUndo).toHaveBeenCalledOnce());
  await mocks.pushUndo.mock.calls[0][0].undo();
  expect(mocks.execute).toHaveBeenLastCalledWith(
    'thread',
    expect.objectContaining({
      type: 'set',
      expectedRevision: null,
      remindAt: previous.remindAt,
      condition: 'regardless',
    })
  );
});

it('reports rolled-back creation without claiming that a reply arrived', async () => {
  mocks.query.mockReturnValue({ isSuccess: true, data: null });
  mocks.execute.mockResolvedValueOnce({ state: 'removed' });
  render(() => (
    <EmailReminderComposer
      entity={{ id: 'thread', type: 'email', name: 'Subject' } as EntityData}
      onPending={() => {}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      'The reminder was not set. The conversation has been restored.'
    )
  );
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.pushUndo).not.toHaveBeenCalled();
});

it.each(['Save', 'Remove'])(
  'starts a fresh %s operation when another writer changes the revision',
  async (action) => {
    const previous: EmailFollowup = {
      condition: 'if_no_reply',
      linkId: 'inbox',
      remindAt: '2026-12-01T12:00:00.000Z',
      reminderId: 'reminder',
      revision: 'original',
      state: 'pending',
      threadId: 'thread',
    };
    const [current, setCurrent] = createSignal(previous);
    mocks.query.mockReturnValue({
      isSuccess: true,
      get data() {
        return current();
      },
    });
    mocks.execute.mockRejectedValue(new Error('Conflict'));
    render(() => (
      <EmailReminderComposer
        entity={{ id: 'thread', type: 'email', name: 'Subject' } as EntityData}
        onPending={() => {}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: action }).hasAttribute('disabled')
      ).toBe(false)
    );
    setCurrent({ ...previous, revision: 'other-writer' });
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(mocks.execute.mock.calls[1][1].expectedRevision).toBe(
      'other-writer'
    );
    expect(mocks.execute.mock.calls[1][1].operationId).not.toBe(
      mocks.execute.mock.calls[0][1].operationId
    );
  }
);
