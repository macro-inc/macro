import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailReminderDetails } from './email-reminder-details';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock('@queries/reminders/email-followup', () => ({
  executeEmailFollowup: mocks.execute,
  useEmailFollowupQuery: mocks.query,
}));
vi.mock('@core/component/ItemPreview', () => ({ ItemPreview: () => null }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('../components/email-reminder-form', () => ({
  EmailReminderForm: (props: {
    onSave: (at: Date, condition: 'if_no_reply') => void;
    pending: boolean;
  }) => (
    <button
      disabled={props.pending}
      onClick={() =>
        props.onSave(new Date('2026-12-01T12:00:00Z'), 'if_no_reply')
      }
    >
      Save
    </button>
  ),
}));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it.each([false, true])(
  'retries against a refetched revision (competing writer: %s)',
  async (competing) => {
    const initial: EmailFollowup = {
      condition: 'if_no_reply',
      linkId: 'inbox',
      remindAt: '2026-12-01T12:00:00.000Z',
      reminderId: 'reminder',
      revision: 'original',
      state: 'pending',
      threadId: 'thread',
    };
    const [current, setCurrent] = createSignal(initial);
    mocks.query.mockReturnValue({
      isSuccess: true,
      get data() {
        return current();
      },
    });
    mocks.execute.mockRejectedValueOnce(new Error('Response lost'));
    const close = vi.fn();
    render(() => (
      <EmailReminderDetails
        reminder={{ id: 'reminder', description: 'Subject' } as Reminder}
        threadId="thread"
        onClose={close}
      >
        <p>Generic editor</p>
      </EmailReminderDetails>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')
      ).toBe(false)
    );
    const first = mocks.execute.mock.calls[0][1];
    setCurrent({
      ...initial,
      revision: competing ? 'competing' : first.operationId,
    });
    mocks.execute.mockResolvedValueOnce(current());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const second = mocks.execute.mock.calls[1][1];
    if (competing) {
      expect(second.operationId).not.toBe(first.operationId);
      expect(second.expectedRevision).toBe('competing');
    } else {
      expect(second).toEqual(first);
    }
  }
);
