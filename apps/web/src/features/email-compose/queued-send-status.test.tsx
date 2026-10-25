import type { EmailSendIntent } from '@queries/email/send-queue';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ComponentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueuedSendStatus } from './queued-send-status';

const mocks = vi.hoisted(() => ({
  intents: [] as EmailSendIntent[],
  refresh: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  restore: vi.fn(async () => {}),
  recover: vi.fn(async () => {}),
}));
vi.mock('@queries/email/draft-queue', () => ({ draftQueueActive: () => true }));
vi.mock('@queries/email/queued-sends', () => ({
  useQueuedEmailSends: () => ({
    intents: () => mocks.intents,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@queries/email/send-queue', () => ({
  cancelEmailSendQueued: mocks.cancel,
  restoreCancelledEmailSend: mocks.restore,
  recoverEmailSendIntent: mocks.recover,
  settledSendAttempt: (intent: EmailSendIntent) =>
    intent.response?.sendEmailMessage?.attempt,
  emailSendLocked: () => true,
}));
vi.mock('@ui', () => ({
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

function showStatus(
  status: 'ACCEPTED' | 'FAILED' | 'DELIVERY_UNCONFIRMED',
  {
    cancellationPending = false,
    sendTime = null as string | null,
    failures = 0,
  } = {}
) {
  mocks.intents = [
    {
      uuid: 'attempt',
      phase: cancellationPending ? 'pending' : 'committed',
      locallyCancelled: false,
      dispatchVersion: 2,
      cancellationRequested: cancellationPending,
      dispatch: { generation: 1, leaseUntil: 0, nextAttemptAt: 0, failures },
      metadata: {
        kind: 'email-send-v1',
        payload: {
          draft: {
            draftId: 'draft',
            threadDbId: 'thread',
            senderLinkId: 'inbox',
            senderEmail: 'sender@example.com',
            subject: 'Saved message',
            optimisticBodyHtml: null,
          },
          input: {
            attempt: { attemptId: 'attempt', linkId: 'inbox' },
            message: {
              draftId: 'draft',
              subject: 'Saved message',
              sendTime,
            },
            attachmentIds: [],
            forwardedAttachmentIds: [],
          },
        },
      },
      response: {
        sendEmailMessage: {
          attempt: {
            attemptId: 'attempt',
            status,
            sendTime: null,
            threadId: 'thread',
            message: null,
          },
        },
      },
    },
  ];
  return render(() => <QueuedSendStatus />);
}

it('stays silent while an immediate send is accepted and delivering', () => {
  showStatus('ACCEPTED');
  expect(screen.queryByLabelText('Queued email sends')).toBeNull();
});

it('keeps an accepted scheduled send cancellable until its send time', async () => {
  showStatus('ACCEPTED', { sendTime: '2026-10-23T09:00:00.000Z' });
  expect(screen.getByRole('status').textContent).toContain('Scheduled');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
  expect(mocks.restore).not.toHaveBeenCalled();
});

it('stays silent while an Undo is confirming with the server', () => {
  showStatus('ACCEPTED', { cancellationPending: true });
  expect(screen.queryByLabelText('Queued email sends')).toBeNull();
});

it('shows a cancellation that cannot reach the server', () => {
  showStatus('ACCEPTED', { cancellationPending: true, failures: 1 });
  expect(screen.getByRole('status').textContent).toBe('Cancellation pending');
  expect(
    screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')
  ).toBe(true);
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it('explains a failure before delivery and offers cancellation for recovery', async () => {
  showStatus('FAILED');
  expect(screen.getByRole('status').textContent).toContain(
    'failed before delivery'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
  expect(mocks.restore).not.toHaveBeenCalled();
});

it('keeps uncertain delivery read-only and offers only status reconciliation', async () => {
  showStatus('DELIVERY_UNCONFIRMED');
  expect(screen.getByRole('status').textContent).toContain(
    'may already have been sent'
  );
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore draft' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith());
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.restore).not.toHaveBeenCalled();
});

it('shows a status refresh error and permits checking again', async () => {
  mocks.recover.mockRejectedValueOnce(new Error('You are offline'));
  showStatus('DELIVERY_UNCONFIRMED');
  const checkStatus = screen.getByRole('button', { name: 'Check status' });
  fireEvent.click(checkStatus);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe('You are offline')
  );
  fireEvent.click(checkStatus);
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.cancel).not.toHaveBeenCalled();
});
