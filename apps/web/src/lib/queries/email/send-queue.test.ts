import { beforeEach, expect, it, vi } from 'vitest';
import type { GraphqlSaveEmailDraftArgs } from './graphql/draft';
import {
  cancelEmailSendAndConfirm,
  cancelEmailSendQueued,
  type EmailSendIntent,
  emailSendLocked,
  readEmailSendIntents,
  recoverEmailSendIntent,
  restoreCancelledEmailSend,
  retireEmailSendIntent,
  sendEmailQueued,
} from './send-queue';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  persist: vi.fn(),
  local: vi.fn(),
  capture: vi.fn(),
  restore: vi.fn(),
  retire: vi.fn(),
  claim: vi.fn(),
  remove: vi.fn(),
  check: vi.fn(),
  publish: vi.fn(),
  status: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@service-storage/email-send', () => ({
  readEmailSendStatus: mocks.status,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () => {
    throw new Error('Cache unavailable');
  },
  getGraphqlSoupClient: () => {
    throw new Error('Cache unavailable');
  },
}));
vi.mock('./local-drafts', () => ({
  readLocalEmailSends: mocks.read,
  persistLocalEmailSend: mocks.persist,
  readLocalDraft: mocks.local,
  removeLocalEmailSend: mocks.remove,
  watchLocalEmailSends: vi.fn(() => () => {}),
  emailStorageSession: async () => ({ accountId: 'owner', epoch: 'session' }),
  localDraftStore: {
    restoreSend: mocks.claim,
    removeSend: mocks.remove,
    requestSendCheck: mocks.check,
  },
}));
vi.mock('./draft-queue', () => ({ saveEmailDraftQueued: mocks.save }));
vi.mock('./draft-lifecycle-events', () => ({
  publishDraftRestoration: mocks.publish,
}));
vi.mock('./send-draft-lifecycle', () => ({
  captureSendWorkingCopy: mocks.capture,
  restoreSendWorkingCopy: mocks.restore,
  retireSendWorkingCopy: mocks.retire,
}));
const draft: GraphqlSaveEmailDraftArgs = {
  draftId: '00000000-0000-4000-8000-000000000001',
  threadDbId: '00000000-0000-4000-8000-000000000002',
  senderLinkId: '00000000-0000-4000-8000-000000000003',
  senderEmail: 'alias@example.invalid',
  subject: 'Approved',
  to: [{ email: 'recipient@example.invalid' }],
  bodyText: 'Approved body',
  bodyHtml: 'QXBwcm92ZWQ=',
  optimisticBodyHtml: 'Approved',
  draftGeneration: 2,
};
const args = () => ({
  draft: structuredClone(draft),
  attachmentIds: ['uploaded'],
  forwardedAttachmentIds: ['native'],
});
const persisted = () => mocks.persist.mock.calls[0][0] as EmailSendIntent;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue([]);
  mocks.local.mockResolvedValue(undefined);
  mocks.capture.mockResolvedValue(undefined);
  mocks.persist.mockImplementation(async (row) => row);
  mocks.claim.mockResolvedValue(undefined);
  mocks.restore.mockImplementation(async (row) => ({
    ...row,
    restorationVersion: {
      key: row.draftId,
      generation: 'restored',
      revision: 1,
    },
  }));
});
it('persists approval without contacting the network or normalized cache', async () => {
  const result = await sendEmailQueued({
    ...args(),
    signatureHtml: '<p>Signature</p>',
    draft: { ...draft, sendTime: '2030-01-01T12:00:00Z' },
  });
  expect(mocks.persist).toHaveBeenCalledWith(
    expect.objectContaining({ dispatchVersion: 2, phase: 'pending' }),
    true
  );
  expect(persisted().metadata.payload.input).toMatchObject({
    attempt: { attemptId: result.sendAttemptId, linkId: draft.senderLinkId },
    message: {
      draftId: draft.draftId,
      draftGeneration: 2,
      senderEmail: draft.senderEmail,
      sendTime: '2030-01-01T12:00:00Z',
    },
    attachmentIds: ['uploaded'],
    forwardedAttachmentIds: ['native'],
    signatureHtml: '<p>Signature</p>',
  });
  expect(mocks.status).not.toHaveBeenCalled();
  expect(result.persistence).toBe('queued');
});
it('freezes the exact input before any asynchronous storage read', async () => {
  const pending = Promise.withResolvers<EmailSendIntent[]>();
  mocks.read.mockReturnValueOnce(pending.promise);
  const input = args();
  const send = sendEmailQueued(input);
  input.draft.subject = 'Later edit';
  input.attachmentIds.push('later attachment');
  pending.resolve([]);
  await send;
  expect(persisted().metadata.payload.input.message.subject).toBe('Approved');
  expect(persisted().metadata.payload.input.attachmentIds).toEqual([
    'uploaded',
  ]);
});
it('does not claim success when local durable storage rejects the write', async () => {
  mocks.persist.mockRejectedValueOnce(
    new DOMException('Full', 'QuotaExceededError')
  );
  await expect(sendEmailQueued(args())).rejects.toThrow('Full');
  expect(mocks.status).not.toHaveBeenCalled();
});
it('resolves server aliases while reserving the captured working-copy revision', async () => {
  mocks.local.mockResolvedValue({
    serverDraftId: 'server',
    serverThreadId: 'thread',
  });
  mocks.capture.mockResolvedValue({
    key: draft.draftId,
    generation: 'g',
    revision: 5,
    attachments: [],
  });
  await sendEmailQueued({
    ...args(),
    expectedLocalVersion: { generation: 'g', revision: 5 },
  });
  expect(persisted().metadata.payload.input.message.draftId).toBe('server');
  expect(mocks.capture).toHaveBeenCalledWith(
    draft.draftId,
    ['uploaded'],
    ['native'],
    { generation: 'g', revision: 5 }
  );
});
it('blocks a second attempt for a draft whose first send is unresolved', async () => {
  await sendEmailQueued(args());
  const first = persisted();
  mocks.read.mockResolvedValue([first]);
  mocks.persist.mockClear();
  await expect(sendEmailQueued(args())).rejects.toThrow('already queued');
  expect(mocks.persist).not.toHaveBeenCalled();
});
it('persists cancellation without deciding an attempted send is cancelled', async () => {
  await sendEmailQueued(args());
  const row = persisted();
  mocks.persist.mockClear();
  const cancelled = await cancelEmailSendQueued({
    ...row,
    submissionStarted: true,
  });
  expect(cancelled.cancellationRequested).toBe(true);
  expect(emailSendLocked(cancelled)).toBe(true);
  expect(mocks.status).not.toHaveBeenCalled();
});
it.each(['SENDING', 'SENT', 'DELIVERY_UNCONFIRMED'] as const)(
  'refuses to unlock %s',
  async (status) => {
    await sendEmailQueued(args());
    const row = persisted();
    row.response = {
      sendEmailMessage: {
        attempt: {
          attemptId: row.uuid,
          status,
          message: null,
          threadId: null,
          sendTime: null,
        },
      },
    };
    await expect(cancelEmailSendQueued(row)).rejects.toThrow();
    mocks.claim.mockRejectedValueOnce(new Error('Confirm cancellation'));
    await expect(restoreCancelledEmailSend(row)).rejects.toThrow(
      'Confirm cancellation'
    );
    expect(mocks.restore).not.toHaveBeenCalled();
  }
);
it('manual reconciliation wakes the existing attempt without bypassing its lease', async () => {
  await sendEmailQueued(args());
  const row = persisted();
  await recoverEmailSendIntent(row);
  expect(mocks.check).toHaveBeenCalledWith(expect.anything(), row.uuid);
  expect(mocks.status).not.toHaveBeenCalled();
});
it('restores a confirmed cancellation durably without needing a cache write', async () => {
  await sendEmailQueued(args());
  const row = {
    ...persisted(),
    cancellationRequested: true,
    locallyCancelled: true,
  };
  mocks.read.mockResolvedValue([row]);
  mocks.claim.mockResolvedValueOnce({
    intent: row,
    draft: {
      draftId: draft.draftId,
      threadId: draft.threadDbId,
      content: {},
      inboxId: draft.senderLinkId,
    },
  });
  await restoreCancelledEmailSend(row);
  expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), row.uuid);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.publish).toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('a stale observer cannot retire accepted delivery authority', async () => {
  await sendEmailQueued(args());
  const row = persisted();
  mocks.read.mockResolvedValue([row]);
  expect(await retireEmailSendIntent(row)).toBe(false);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('preserves malformed durable entries for recovery instead of treating the queue as empty', async () => {
  mocks.read.mockResolvedValue([{ uuid: 'damaged' }]);
  expect(await readEmailSendIntents()).toEqual([]);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('keeps scheduled cancellation pending until authoritative confirmation', async () => {
  vi.useFakeTimers();
  try {
    await sendEmailQueued(args());
    const row = { ...persisted(), submissionStarted: true };
    row.metadata.requiresServerConfirmation = true;
    mocks.read.mockResolvedValue([row]);
    let completed = false;
    const cancellation = cancelEmailSendAndConfirm(row).then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(completed).toBe(false);
    expect(mocks.claim).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue([
      {
        ...row,
        response: {
          cancelEmailSend: {
            attempt: {
              attemptId: row.uuid,
              status: 'CANCELLED',
              message: null,
              threadId: null,
              sendTime: null,
            },
          },
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(250);
    await cancellation;
    expect(completed).toBe(true);
    expect(mocks.claim).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
