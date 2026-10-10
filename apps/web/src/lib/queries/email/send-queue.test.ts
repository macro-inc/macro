import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import { CombinedError, createClient, type Operation } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';
import type { GraphqlSaveEmailDraftArgs } from './graphql/draft';
import { persistLocalEmailSend } from './local-drafts';
import {
  cancelEmailSendQueued,
  type EmailSendIntent,
  emailSendLocked,
  emailSendQueueSelected,
  recoverEmailSendIntent,
  restoreCancelledEmailSend,
  sendEmailQueued,
} from './send-queue';

const mocks = vi.hoisted(() => ({
  intents: vi.fn(),
  client: vi.fn(),
  cached: vi.fn(),
  save: vi.fn(),
  error: undefined as CombinedError | undefined,
  disposition: 'queued',
  cancellationStatus: undefined as
    | 'SENDING'
    | 'SENT'
    | 'DELIVERY_UNCONFIRMED'
    | undefined,
  cacheEnabled: vi.fn(),
  rolloutEnabled: vi.fn(),
  restored: vi.fn(),
}));
vi.mock('./local-drafts', () => ({
  readLocalEmailSends: vi.fn(async () => []),
  persistLocalEmailSend: vi.fn(async (intent) => intent),
  removeLocalEmailSend: vi.fn(async () => {}),
  watchLocalEmailSends: vi.fn(() => () => {}),
}));
vi.mock('./draft-lifecycle-events', () => ({
  publishDraftRestoration: mocks.restored,
}));
vi.mock('./send-draft-lifecycle', () => ({
  captureSendWorkingCopy: vi.fn(async () => undefined),
  retireSendWorkingCopy: vi.fn(async () => {}),
  restoreSendWorkingCopy: vi.fn(async (draft: GraphqlSaveEmailDraftArgs) => ({
    ...draft,
    restorationVersion: {
      key: draft.draftId,
      generation: 'restored',
      revision: 1,
    },
    optimisticBodyHtml: draft.bodyHtml
      ? decodeBase64Utf8(draft.bodyHtml)
      : null,
  })),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: 'graphql',
  isFeatureEnabled: () => true,
}));
vi.mock('@graphql-cache/rollout', () => ({
  getBrowserTursoCacheRolloutDecision: () => ({
    enabled: mocks.rolloutEnabled(),
  }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client(),
  getGraphqlCacheHost: () => ({ durableMutationIntents: mocks.intents }),
  graphqlCacheEnabled: () => mocks.cacheEnabled(),
}));
vi.mock('../soup/graphql/active-queries', () => ({
  getActiveGraphqlSoupRevalidations: () => [],
}));
vi.mock('./draft-queue', () => ({
  readCachedDraftAndThread: (...args: unknown[]) => mocks.cached(...args),
  saveEmailDraftQueued: (...args: unknown[]) => mocks.save(...args),
}));

const draft: GraphqlSaveEmailDraftArgs = {
  draftId: '00000000-0000-4000-8000-000000000001',
  threadDbId: '00000000-0000-4000-8000-000000000002',
  senderLinkId: '00000000-0000-4000-8000-000000000003',
  senderEmail: 'sender@example.com',
  subject: 'Approved subject',
  to: [{ email: 'to@example.com' }],
  bodyText: 'Approved body',
  bodyHtml: 'PHA-QXBwcm92ZWQgYm9keTwvcD4',
  optimisticBodyHtml: '<p>Approved body</p>',
  newThreadOwnerId: 'macro|sender@example.com',
};
let operations: Operation[];
beforeEach(() => {
  mocks.restored.mockClear();
  mocks.cacheEnabled.mockReturnValue(true);
  mocks.rolloutEnabled.mockReturnValue(true);
  operations = [];
  mocks.error = undefined;
  mocks.disposition = 'queued';
  mocks.cancellationStatus = undefined;
  mocks.intents.mockResolvedValue([]);
  mocks.cached.mockResolvedValue({
    draftId: draft.draftId,
    threadDbId: draft.threadDbId,
  });
  mocks.save.mockResolvedValue({ kind: 'queued' });
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      () => (source) =>
        pipe(
          source,
          map((operation) => {
            operations.push(operation);
            return {
              operation,
              error: mocks.error,
              stale: false,
              hasNext: false,
              data: mocks.cancellationStatus
                ? {
                    cancelEmailSend: {
                      attempt: { status: mocks.cancellationStatus },
                    },
                  }
                : undefined,
              extensions: {
                normalizedCacheMutationDisposition: {
                  kind: mocks.disposition,
                  transactionId: '1',
                },
              },
            };
          })
        ),
    ],
  });
  mocks.client.mockReturnValue(client);
});

it('retains legacy sending when GraphQL is enabled without the durable cache rollout', () => {
  mocks.cacheEnabled.mockReturnValue(false);
  mocks.rolloutEnabled.mockReturnValue(false);
  expect(emailSendQueueSelected('graphql')).toBe(false);
});

it('requires durable storage when an enabled cache fails to initialize', () => {
  mocks.cacheEnabled.mockReturnValue(false);
  expect(emailSendQueueSelected('graphql')).toBe(true);
  expect(emailSendQueueSelected('rest')).toBe(false);
});

it('queues the selected inbox with existing draft identity for atomic admission', async () => {
  const selectedInbox = '00000000-0000-4000-8000-000000000004';
  await sendEmailQueued({
    draft: {
      ...draft,
      senderLinkId: selectedInbox,
      senderEmail: 'other-inbox@example.com',
    },
    attachmentIds: ['uploaded'],
    forwardedAttachmentIds: [],
  });
  expect(operations[0].variables?.input).toMatchObject({
    attempt: { linkId: selectedInbox },
    message: { draftId: draft.draftId, linkId: selectedInbox },
    attachmentIds: ['uploaded'],
  });
  expect(optimisticContextOf(operations[0])!.durableIntent).toMatchObject({
    payload: {
      draft: { senderLinkId: selectedInbox },
    },
  });
});

async function send(): Promise<EmailSendIntent> {
  await sendEmailQueued({
    draft,
    attachmentIds: ['uploaded'],
    forwardedAttachmentIds: ['forwarded'],
    restoreBodyText: 'Editable body',
  });
  const context = optimisticContextOf(operations[0])!;
  return {
    uuid: context.uuid,
    phase: 'pending',
    locallyCancelled: false,
    metadata: context.durableIntent as EmailSendIntent['metadata'],
  };
}

describe('durable email send intent', () => {
  it('persists the approved envelope, inbox, attachments and recovery body before acknowledging', async () => {
    const intent = await send();
    expect(intent.metadata.payload.input).toMatchObject({
      attempt: { attemptId: intent.uuid, linkId: draft.senderLinkId },
      message: {
        draftId: draft.draftId,
        subject: draft.subject,
        to: draft.to,
        bodyText: draft.bodyText,
      },
      attachmentIds: ['uploaded'],
      forwardedAttachmentIds: ['forwarded'],
      restoreBodyText: 'Editable body',
    });
    expect(operations[0].variables?.input).toEqual(
      intent.metadata.payload.input
    );
    expect(JSON.stringify(operations[0].variables)).not.toContain(
      'existingThread'
    );
    expect(emailSendLocked(intent)).toBe(true);
    expect(intent.metadata.exclusive).toEqual({
      entityKey: `GraphqlSoupEmailMessage:${draft.draftId}`,
      releaseOn: {
        responsePath: ['cancelEmailSend', 'attempt', 'status'],
        value: 'CANCELLED',
      },
    });
  });
  it('acknowledges a persisted send and cancellation despite a failed initial network attempt', async () => {
    mocks.error = new CombinedError({
      networkError: new Error('connection lost'),
    });
    const intent = await send();
    const cancelled = { ...intent, locallyCancelled: true };
    mocks.intents.mockResolvedValue([cancelled]);
    await expect(cancelEmailSendQueued(intent)).resolves.toMatchObject(
      cancelled
    );
    expect(operations).toHaveLength(2);
  });
  it('resolves queued draft handles before checking a canonical draft for duplicate sends', async () => {
    const intent = await send();
    mocks.intents.mockResolvedValue([intent]);
    mocks.cached.mockResolvedValue({
      draftId: 'server-message',
      threadDbId: 'server-thread',
    });
    await expect(
      sendEmailQueued({
        draft: { ...draft, draftId: 'server-message' },
        attachmentIds: [],
        forwardedAttachmentIds: [],
      })
    ).rejects.toThrow('already queued');
  });

  it('uses the same attempt UUID to atomically replace send with cancellation', async () => {
    const intent = await send();
    mocks.intents.mockResolvedValue([intent]);
    await cancelEmailSendQueued(intent);
    expect(operations[1].variables).toEqual({
      input: intent.metadata.payload.input.attempt,
    });
    expect(optimisticContextOf(operations[1])).toMatchObject({
      uuid: intent.uuid,
      durableIntent: { replace: true },
    });
    expect(
      emailSendLocked({
        ...intent,
        metadata: { ...intent.metadata, replace: true },
      })
    ).toBe(true);
    expect(emailSendLocked({ ...intent, locallyCancelled: true })).toBe(false);
  });
  it.each(['SENDING', 'SENT'] as const)(
    'rejects cancellation once delivery is %s',
    async (status) => {
      const intent = await send();
      mocks.disposition = 'committed';
      mocks.cancellationStatus = status;
      await expect(cancelEmailSendQueued(intent)).rejects.toThrow(
        'Delivery already started'
      );
    }
  );
  it('surfaces storage failure instead of claiming cancellation succeeded', async () => {
    const intent = await send();
    mocks.intents.mockRejectedValue(new Error('journal read failed'));
    await expect(cancelEmailSendQueued(intent)).rejects.toThrow(
      'journal read failed'
    );
  });
  it('reports unconfirmed provider delivery without unlocking or restoring the send', async () => {
    const intent = await send();
    mocks.disposition = 'committed';
    mocks.cancellationStatus = 'DELIVERY_UNCONFIRMED';
    await expect(cancelEmailSendQueued(intent)).rejects.toThrow(
      'Delivery unconfirmed; check your sent mail'
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('refuses a second send for the same locked draft', async () => {
    const intent = await send();
    mocks.intents.mockResolvedValue([intent]);
    await expect(
      sendEmailQueued({ draft, attachmentIds: [], forwardedAttachmentIds: [] })
    ).rejects.toThrow('already queued');
    expect(operations).toHaveLength(1);
  });
  it('restores pre-send content under the original identity without dropping attachments', async () => {
    const intent = await send();
    await expect(restoreCancelledEmailSend(intent)).rejects.toThrow(
      'Confirm cancellation'
    );
    await restoreCancelledEmailSend({
      ...intent,
      phase: 'committed',
      locallyCancelled: true,
    });
    const backups = vi
      .mocked(persistLocalEmailSend)
      .mock.calls.slice(-2)
      .map(([row]) => row);
    expect(backups).toHaveLength(2);
    for (const backup of backups) {
      expect(backup.phase).toBe('pending');
      expect(backup.response).toBeUndefined();
      expect(backup.metadata.exclusive).toBeUndefined();
      expect(backup.metadata.payload.draft.bodyText).toBe('Editable body');
    }
    expect(mocks.save).toHaveBeenCalledWith({
      args: expect.objectContaining({
        draftId: draft.draftId,
        threadDbId: draft.threadDbId,
        bodyText: 'Editable body',
        mutationUuid: intent.uuid,
        durableIntent: expect.objectContaining({
          exclusive: undefined,
          replace: true,
          payload: expect.objectContaining({
            draft: expect.objectContaining({ bodyText: 'Editable body' }),
            restoring: true,
            restorationVersion: {
              key: draft.draftId,
              generation: 'restored',
              revision: 1,
            },
          }),
        }),
      }),
    });
    expect(mocks.restored).toHaveBeenCalledWith({
      draftId: draft.draftId,
      inboxId: draft.senderLinkId,
      restoration: expect.objectContaining({
        originalDraftId: draft.draftId,
        threadId: draft.threadDbId,
      }),
    });
  });
  it('publishes both local and committed identity after restoration resolves aliases', async () => {
    const intent = await send();
    mocks.save.mockResolvedValue({
      kind: 'committed',
      draftId: 'canonical-draft',
      threadId: 'canonical-thread',
    });
    await restoreCancelledEmailSend({ ...intent, locallyCancelled: true });
    expect(mocks.restored).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: 'canonical-draft',
        restoration: expect.objectContaining({
          originalDraftId: draft.draftId,
          threadId: 'canonical-thread',
        }),
      })
    );
  });
});

it('cache recovery replays the frozen send with the original attempt ID', async () => {
  const intent = await send();
  operations = [];
  await recoverEmailSendIntent({ ...intent, cacheMissing: true });
  const replay = operations.find((operation) => operation.kind === 'mutation')!;
  expect(replay.variables!.input).toEqual(intent.metadata.payload.input);
  expect(optimisticContextOf(replay)?.uuid).toBe(intent.uuid);
});
it('cache recovery honors cancellation instead of recreating a send', async () => {
  const intent = await send();
  mocks.intents.mockResolvedValue([intent]);
  operations = [];
  await recoverEmailSendIntent({
    ...intent,
    cacheMissing: true,
    cancellationRequested: true,
  });
  const replay = operations.find((operation) => operation.kind === 'mutation')!;
  expect(replay.variables!.input).toEqual(
    intent.metadata.payload.input.attempt
  );
  expect(optimisticContextOf(replay)?.uuid).toBe(intent.uuid);
});
it('cache recovery preserves restored content and its acknowledged revision', async () => {
  const intent = await send();
  const restored = {
    ...intent,
    cacheMissing: true,
    metadata: {
      ...intent.metadata,
      payload: {
        ...intent.metadata.payload,
        restoring: true,
        draft: { ...draft, bodyText: 'Restored and edited body' },
        restorationVersion: {
          key: String(draft.draftId),
          generation: 'newer',
          revision: 3,
        },
      },
    },
  };
  await recoverEmailSendIntent(restored);
  expect(mocks.save).toHaveBeenCalledWith({
    args: expect.objectContaining({
      bodyText: 'Restored and edited body',
      mutationUuid: intent.uuid,
      durableIntent: expect.objectContaining({
        payload: expect.objectContaining({
          restorationVersion: restored.metadata.payload.restorationVersion,
        }),
      }),
    }),
  });
});
it('cache recovery never automatically retries a permanently failed send', async () => {
  const intent = await send();
  operations = [];
  await recoverEmailSendIntent({
    ...intent,
    cacheMissing: true,
    phase: 'failed',
  });
  expect(
    operations.filter((operation) => operation.kind === 'mutation')
  ).toEqual([]);
});
