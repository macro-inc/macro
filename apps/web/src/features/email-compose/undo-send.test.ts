import {
  EmailSendCancellationPending,
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
  confirm: vi.fn(),
  promise: vi.fn(async (pending: Promise<unknown>) => await pending),
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
  cancelEmailSendAndConfirm: mocks.confirm,
  EmailSendCancellationPending: class extends Error {},
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
  dispatchVersion: 2,
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

const onUndone = vi.fn();
const options = { draftId: 'draft', attemptId: intent.uuid, onUndone };
beforeEach(() => {
  vi.clearAllMocks();
  endUndoSend(options.draftId);
  mocks.read.mockResolvedValue([intent]);
  mocks.confirm.mockResolvedValue(undefined);
});

it('restores the persisted cancellation and reopens the draft after navigation disposes the composer', async () => {
  const undo = createRoot((dispose) => {
    const undo = () => runQueuedUndoSend(options);
    dispose();
    return undo;
  });
  await undo();
  expect(mocks.confirm).toHaveBeenCalledWith(intent);
  expect(onUndone).toHaveBeenCalledOnce();
  expect(mocks.success).toHaveBeenCalledWith('Send cancelled');
  await undo();
  expect(mocks.confirm).toHaveBeenCalledOnce();
});

it('keeps unconfirmed cancellation locked, gives feedback, and allows a confirmed retry', async () => {
  mocks.confirm.mockRejectedValueOnce(new EmailSendCancellationPending());
  await runQueuedUndoSend(options);
  expect(onUndone).not.toHaveBeenCalled();
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledWith(
    'Cancellation pending — waiting for confirmation'
  );
  await runQueuedUndoSend(options);
  expect(onUndone).toHaveBeenCalledOnce();
  expect(mocks.success).toHaveBeenCalledWith('Send cancelled');
});

it.each([
  [
    new EmailSendCancellationTooLate(),
    'Too late to undo — delivery has already started',
  ],
  [new Error('storage unavailable'), 'Failed to undo send'],
  [new Error('restore failed'), 'Failed to undo send'],
  [
    new EmailSendDeliveryUnconfirmed(),
    'Delivery unconfirmed; check your sent mail. We will not resend automatically.',
  ],
])(
  'shows cancellation failures and allows retry: %s',
  async (error, message) => {
    mocks.confirm.mockRejectedValueOnce(error);
    await runQueuedUndoSend(options);
    expect(mocks.failure).toHaveBeenCalledWith(message);
    expect(mocks.error).toHaveBeenCalledWith(error);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onUndone).not.toHaveBeenCalled();
    await runQueuedUndoSend(options);
    expect(onUndone).toHaveBeenCalledOnce();
  }
);
