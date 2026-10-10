import {
  EmailSendCancellationTooLate,
  EmailSendDeliveryUnconfirmed,
  type EmailSendIntent,
} from '@queries/email/send-queue';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { endUndoSend } from './primitives/undo-send-claim';
import { runQueuedUndoSend } from './undo-send';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  cancel: vi.fn(),
  restore: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: mocks }));
vi.mock('@macro-inc/observability', () => ({ Telemetry: mocks }));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/email/integration', () => ({}));
vi.mock('@queries/email/keys', () => ({}));
vi.mock('@queries/soup/cache', () => ({}));
vi.mock('./primitives/prepare-email-body', () => ({}));
vi.mock('@queries/email/send-queue', () => ({
  readEmailSendIntents: mocks.read,
  cancelEmailSendQueued: mocks.cancel,
  restoreCancelledEmailSend: mocks.restore,
  emailSendLocked: (intent: EmailSendIntent) => !intent.locallyCancelled,
  EmailSendCancellationTooLate: class extends Error {},
  EmailSendDeliveryUnconfirmed: class extends Error {
    constructor() {
      super(
        'Delivery unconfirmed; check your sent mail. We will not resend automatically.'
      );
    }
  },
}));

const intent: EmailSendIntent = {
  uuid: 'attempt',
  phase: 'pending',
  locallyCancelled: false,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      input: {
        attempt: { attemptId: 'attempt', linkId: 'inbox' },
        message: {
          draftId: 'draft',
          subject: 'Approved subject',
          to: [],
          cc: [],
          bcc: [],
        },
        attachmentIds: [],
        forwardedAttachmentIds: [],
      },
      draft: {
        draftId: 'draft',
        threadDbId: 'thread',
        senderLinkId: 'inbox',
        senderEmail: 'sender@example.com',
        optimisticBodyHtml: null,
        subject: 'Approved subject',
        to: [],
      },
    },
  },
};

const cancelled = { ...intent, locallyCancelled: true };
const onUndone = vi.fn();
const options = { draftId: 'draft', attemptId: intent.uuid, onUndone };
beforeEach(() => {
  vi.clearAllMocks();
  endUndoSend(options.draftId);
  mocks.read.mockResolvedValue([intent]);
  mocks.cancel.mockResolvedValue(cancelled);
  mocks.restore.mockResolvedValue(undefined);
});

it('restores the persisted cancellation and reopens the draft after navigation disposes the composer', async () => {
  const undo = createRoot((dispose) => {
    const undo = () => runQueuedUndoSend(options);
    dispose();
    return undo;
  });
  await undo();
  expect(mocks.restore).toHaveBeenCalledWith(cancelled);
  expect(onUndone).toHaveBeenCalledOnce();
  expect(mocks.success).toHaveBeenCalledWith('Send cancelled');
  await undo();
  expect(mocks.cancel).toHaveBeenCalledOnce();
});

it('keeps uncertain cancellation locked, gives feedback, and allows a confirmed retry', async () => {
  mocks.cancel.mockResolvedValueOnce(intent);
  await runQueuedUndoSend(options);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(onUndone).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith(
    'Cancellation pending — waiting for confirmation'
  );
  await runQueuedUndoSend(options);
  expect(mocks.restore).toHaveBeenCalledWith(cancelled);
  expect(onUndone).toHaveBeenCalledOnce();
});

it.each([
  [
    new EmailSendCancellationTooLate(),
    'Too late to undo — delivery has already started',
  ],
  [new Error('storage unavailable'), 'Failed to undo send'],
  [
    new EmailSendDeliveryUnconfirmed(),
    'Delivery unconfirmed; check your sent mail. We will not resend automatically.',
  ],
])(
  'shows cancellation failures and allows retry: %s',
  async (error, message) => {
    mocks.cancel.mockRejectedValueOnce(error);
    await runQueuedUndoSend(options);
    expect(mocks.failure).toHaveBeenCalledWith(message);
    expect(mocks.error).toHaveBeenCalledWith(error);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(onUndone).not.toHaveBeenCalled();
    await runQueuedUndoSend(options);
    expect(onUndone).toHaveBeenCalledOnce();
  }
);

it('reports failed restoration without claiming success or losing the recovery intent', async () => {
  mocks.restore.mockRejectedValueOnce(new Error('restore failed'));
  await runQueuedUndoSend(options);
  expect(mocks.failure).toHaveBeenCalledWith('Failed to undo send');
  expect(mocks.success).not.toHaveBeenCalled();
  expect(onUndone).not.toHaveBeenCalled();
  await runQueuedUndoSend(options);
  expect(onUndone).toHaveBeenCalledOnce();
});
