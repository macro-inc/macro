import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import { toast } from '@core/component/Toast/Toast';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import type {
  DeleteEmailDraftMutation,
  SaveEmailDraftMutation,
} from '@service-storage/graphql/generated/graphql';
import {
  type Client,
  CombinedError,
  createClient,
  type Operation,
} from '@urql/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';
import { queryClient } from '../client';
import { refetchSoupEntity } from '../soup/cache';
import { emailKeys } from './keys';
import {
  beginDraftAttempt,
  emailSendOwnsDraft,
  localDraftMessage,
  markDraftAttemptQueued,
  readLocalDraft,
  readLocalEmailSends,
  restoreLocalAttachments,
  watchLocalEmailSends,
} from './local-drafts';
import type { EmailSendIntent } from './send-intent';

const mocks = vi.hoisted(() => ({
  readRecordsByKeys: vi.fn(),
  onCacheChanged: vi.fn(),
  onMutationSettled: vi.fn(),
  client: undefined as Client | undefined,
  queueBlocked: false,
  cacheEnabled: true,
  proofCurrent: true,
  assertQueueAvailable: vi.fn(),
}));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAuthority: { hasCurrentProof: () => mocks.proofCurrent },
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn(), info: vi.fn() },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  assertEmailDraftQueueAvailable: mocks.assertQueueAvailable,
  graphqlDraftQueueBlocked: () => mocks.queueBlocked,
  getGraphqlCacheHost: () => ({
    readRecordsByKeys: mocks.readRecordsByKeys,
    onCacheChanged: mocks.onCacheChanged,
    onMutationSettled: mocks.onMutationSettled,
  }),
  getGraphqlSoupClient: () => mocks.client,
  graphqlCacheEnabled: () => mocks.cacheEnabled,
}));
vi.mock('../client', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../soup/cache', () => ({
  invalidateAllSoup: vi.fn(),
  invalidateSoupEntity: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));
vi.mock('./thread', () => ({ fetchAndCacheThread: vi.fn() }));

import {
  deleteEmailDraftQueued,
  draftQueueActive,
  readCachedDraftAndThread,
  readEmailDraft,
  saveEmailDraftQueued,
  watchEmailDrafts,
} from './draft-queue';
import {
  executeGraphqlSaveEmailDraft,
  type GraphqlSaveEmailDraftArgs,
} from './graphql/draft';
import { fetchAndCacheThread } from './thread';

const handle = '01991e2a-3111-7000-8000-000000000001';
const serverId = '01991e2a-3111-7000-8000-000000000002';
const args: GraphqlSaveEmailDraftArgs = {
  draftId: handle,
  threadDbId: 'local-thread',
  senderLinkId: 'inbox',
  senderEmail: 'sender@example.com',
  subject: 'Draft',
  optimisticBodyHtml: '<p>Latest edit</p>',
  newThreadOwnerId: 'owner',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.queueBlocked = false;
  mocks.cacheEnabled = true;
  mocks.proofCurrent = true;
  vi.mocked(queryClient.invalidateQueries).mockResolvedValue(undefined);
  vi.mocked(refetchSoupEntity).mockResolvedValue(undefined);
  vi.mocked(beginDraftAttempt).mockResolvedValue({
    kind: 'email-draft',
    id: 'attempt',
    draftKey: 'draft',
    accountId: 'owner',
    generation: 'generation',
    revision: 1,
    operation: 'save',
  });
});

async function setup(committed = false, retired = false) {
  const operations: Operation[] = [];
  const client = createClient({
    url: 'http://example.test/graphql',
    exchanges: [
      () => (source) =>
        pipe(
          source,
          map((operation) => {
            operations.push(operation);
            return {
              operation,
              stale: false,
              hasNext: false,
              ...(committed && !retired
                ? { data: optimisticContextOf(operation)?.optimisticResponse }
                : {}),
              extensions: {
                normalizedCacheMutationDisposition: {
                  kind: committed ? 'committed' : 'queued',
                  transactionId: 'queued',
                },
              },
            };
          })
        ),
    ],
  });
  mocks.client = client;
  await executeGraphqlSaveEmailDraft(client, args);
  const local = (
    optimisticContextOf(operations.pop()!)!
      .optimisticResponse as SaveEmailDraftMutation
  ).saveEmailDraft;
  await executeGraphqlSaveEmailDraft(client, {
    ...args,
    draftId: serverId,
    threadDbId: 'server-thread',
    optimisticBodyHtml: '<p>Previously saved</p>',
  });
  const canonical = (
    optimisticContextOf(operations.pop()!)!
      .optimisticResponse as SaveEmailDraftMutation
  ).saveEmailDraft;
  const draftResult = (record = canonical.draft, revision = '2') => ({
    revision,
    records: [
      {
        recordKey: `GraphqlSoupEmailMessage:${handle}`,
        record,
        identity: { mutationUuid: handle, pending: revision === '1' },
      },
    ],
  });
  const threadResult = () => ({
    revision: '2',
    records: [
      {
        recordKey: 'GraphqlSoupEmailThread:local-thread',
        record: canonical.thread,
      },
    ],
  });
  mocks.readRecordsByKeys.mockImplementation(({ keys }: { keys: string[] }) =>
    Promise.resolve(
      keys[0].startsWith('GraphqlSoupEmailMessage:')
        ? draftResult()
        : threadResult()
    )
  );
  return { operations, local, draftResult, threadResult };
}

it('keeps active thread messages intact after a committed draft save', async () => {
  await setup(true);
  expect(await saveEmailDraftQueued({ args })).toEqual({
    kind: 'committed',
    draftId: serverId,
    threadId: 'server-thread',
  });
  expect(queryClient.invalidateQueries).toHaveBeenCalledExactlyOnceWith({
    queryKey: emailKeys.previews._def,
  });
  expect(refetchSoupEntity).toHaveBeenCalledWith(
    'server-thread',
    'emailThread'
  );
});

it.each(['save', 'delete'] as const)(
  'enqueues an authored %s using the offline cache without CRM proof',
  async (operation) => {
    const { operations } = await setup();
    mocks.proofCurrent = false;
    vi.mocked(readLocalDraft).mockResolvedValue(workingCopy('dirty'));
    await expect(
      operation === 'save'
        ? saveEmailDraftQueued({ args: { ...args, draftId: serverId } })
        : deleteEmailDraftQueued({
            draftId: serverId,
            threadId: 'local-thread',
          })
    ).resolves.toEqual({ kind: 'queued' });
    expect(mocks.readRecordsByKeys).toHaveBeenCalled();
    expect(operations).toHaveLength(1);
    expect(optimisticContextOf(operations[0])?.uuid).toBe(handle);
    expect(operations[0].variables?.input).toMatchObject({
      draftId: handle,
    });
    if (operation === 'save')
      expect(operations[0].variables?.input.threadDbId).toBe('server-thread');
  }
);

it.each(['save', 'delete'] as const)(
  'blocks an uncached fallback %s before changing local intent or sending a request',
  async (operation) => {
    const { operations } = await setup();
    mocks.assertQueueAvailable.mockImplementation(() => {
      throw new Error('Queued drafts are preserved');
    });
    await expect(
      operation === 'save'
        ? saveEmailDraftQueued({ args })
        : deleteEmailDraftQueued({ draftId: handle, threadId: 'local-thread' })
    ).rejects.toThrow('Queued drafts are preserved');
    expect(operations).toEqual([]);
    expect(readLocalDraft).not.toHaveBeenCalled();
  }
);

it('keeps local persistence enabled for drafts while the queue is unavailable', () => {
  mocks.cacheEnabled = false;
  mocks.queueBlocked = true;
  expect(draftQueueActive()).toBe(true);
  mocks.queueBlocked = false;
  expect(draftQueueActive()).toBe(false);
});

it('uses resolved IDs for an old-handle save without duplicating the cached draft', async () => {
  const { operations } = await setup();
  expect(await saveEmailDraftQueued({ args })).toEqual({ kind: 'queued' });
  const operation = operations[0];
  const optimistic = optimisticContextOf(operation)!;
  const response = optimistic.optimisticResponse as SaveEmailDraftMutation;
  expect(optimistic.uuid).toBe(handle);
  expect(operation.variables?.input).toMatchObject({
    draftId: serverId,
    threadDbId: 'server-thread',
  });
  expect(response.saveEmailDraft.thread.messages).toHaveLength(1);
  expect(response.saveEmailDraft.thread.messages[0]).toMatchObject({
    id: serverId,
    bodyHtmlSanitized: '<p>Latest edit</p>',
  });
  expect(
    response.saveEmailDraft.thread.mailDraftState?.drafts.map((d) => d.id)
  ).toEqual([serverId]);
});

it('removes the resolved draft contribution when discarding an old handle', async () => {
  const { operations } = await setup();
  expect(
    await deleteEmailDraftQueued({ draftId: handle, threadId: 'local-thread' })
  ).toEqual({ kind: 'queued' });
  const operation = operations[0];
  const optimistic = optimisticContextOf(operation)!;
  const response = optimistic.optimisticResponse as DeleteEmailDraftMutation;
  expect(optimistic.uuid).toBe(handle);
  expect(operation.variables?.input.draftId).toBe(serverId);
  expect(response.deleteEmailDraft).toMatchObject({
    threadId: 'server-thread',
    threadDeleted: true,
    thread: { messages: [], mailDraftState: { drafts: [] } },
  });
});

it('retries a draft and thread snapshot spanning identity settlement', async () => {
  const { operations, local, draftResult, threadResult } = await setup();
  mocks.readRecordsByKeys
    .mockResolvedValueOnce(draftResult(local.draft, '1'))
    .mockResolvedValueOnce(threadResult());
  await saveEmailDraftQueued({ args });
  expect(mocks.readRecordsByKeys).toHaveBeenCalledTimes(4);
  const response = optimisticContextOf(operations[0])!
    .optimisticResponse as SaveEmailDraftMutation;
  expect(response.saveEmailDraft.thread.messages).toHaveLength(1);
  expect(response.saveEmailDraft.thread.messages[0].id).toBe(serverId);
  expect(
    response.saveEmailDraft.thread.mailDraftState?.drafts.map((d) => d.id)
  ).toEqual([serverId]);
});

it('queues an authored draft while its optional cached thread cannot be authorized', async () => {
  const { operations } = await setup();
  mocks.readRecordsByKeys.mockRejectedValue(new StaleCacheAuthorityError());
  await expect(saveEmailDraftQueued({ args })).resolves.toEqual({
    kind: 'queued',
  });
  expect(operations).toHaveLength(1);
  expect(operations[0].variables?.input).toMatchObject({ subject: 'Draft' });
  expect(
    JSON.stringify(optimisticContextOf(operations[0])?.optimisticResponse)
  ).not.toContain('Previously saved');
});

it('rejects a continually changing snapshot instead of enqueuing mixed identities', async () => {
  const { operations, local, draftResult, threadResult } = await setup();
  mocks.readRecordsByKeys.mockImplementation(({ keys }: { keys: string[] }) =>
    Promise.resolve(
      keys[0].startsWith('GraphqlSoupEmailMessage:')
        ? draftResult(local.draft, '1')
        : threadResult()
    )
  );
  await expect(saveEmailDraftQueued({ args })).rejects.toThrow(
    'Email draft cache kept changing; retry the draft write'
  );
  expect(mocks.readRecordsByKeys).toHaveBeenCalledTimes(6);
  expect(operations).toEqual([]);
});

it.each([
  ['DRAFT_ALREADY_SENT', 'DRAFT_ALREADY_SENT'],
  ['NOT_FOUND', 'NOT_FOUND'],
  ['INBOX_NOT_FOUND', 'INBOX_NOT_FOUND'],
  ['UNAUTHORIZED', 'UNAUTHORIZED'],
  ['INVALID', 'INVALID'],
  ['INTERNAL', 'INTERNAL'],
  ['UNRECOGNIZED', 'INTERNAL'],
  [undefined, 'INTERNAL'],
] as const)(
  'preserves background failure %s as %s',
  async (errorCode, expected) => {
    let settled!: (result: MutationSettlement) => void;
    const removeCache = vi.fn();
    const removeSettlements = vi.fn();
    mocks.onCacheChanged.mockReturnValue(removeCache);
    mocks.onMutationSettled.mockImplementation((callback) => {
      settled = callback;
      return removeSettlements;
    });
    const changed = vi.fn();
    const stop = watchEmailDrafts(changed);
    settled({
      transactionId: 'tx',
      mutationUuid: handle,
      status: 'permanently-failed',
      error: 'server response',
      errorCode,
    });
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      mutationUuid: handle,
      failed: true,
      code: expected,
    });
    expect(mocks.readRecordsByKeys).not.toHaveBeenCalled();
    expect(fetchAndCacheThread).not.toHaveBeenCalled();
    stop();
    expect(removeCache).toHaveBeenCalledOnce();
    expect(removeSettlements).toHaveBeenCalledOnce();
  }
);

it.each(['committed', 'superseded'] as const)(
  'refreshes %s settlements without reporting a draft rejection',
  (status) => {
    let settled!: (result: MutationSettlement) => void;
    mocks.onMutationSettled.mockImplementation((callback) => {
      settled = callback;
      return () => {};
    });
    mocks.onCacheChanged.mockReturnValue(() => {});
    const changed = vi.fn();
    const stop = watchEmailDrafts(changed);
    settled({
      transactionId: 'tx',
      mutationUuid: handle,
      status,
      replacementTransactionId: 'replacement',
    });
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      mutationUuid: handle,
      failed: false,
      code: undefined,
    });
    expect(fetchAndCacheThread).not.toHaveBeenCalled();
    stop();
  }
);

it('retains a sent record mutation handle without returning editable content', async () => {
  const { draftResult } = await setup();
  const selected = draftResult();
  selected.records[0].record.isDraft = false;
  mocks.readRecordsByKeys.mockResolvedValue(selected);
  expect(await readEmailDraft(serverId)).toEqual({
    draft: undefined,
    persistence: 'committed',
    mutationUuid: handle,
  });
});

vi.mock('./local-drafts', () => ({
  readLocalDraft: vi.fn(async () => undefined),
  localDraftMessage: vi.fn(),
  restoreLocalAttachments: vi.fn(),
  beginDraftAttempt: vi.fn(),
  markDraftAttemptQueued: vi.fn(),
  draftSyncPaused: vi.fn(),
  emailSendOwnsDraft: vi.fn(async () => false),
  readLocalEmailSends: vi.fn(async () => []),
  watchLocalEmailSends: vi.fn(() => () => {}),
  localDraftStore: { subscribe: vi.fn(() => () => {}) },
}));

const workingCopy = (status: LocalDraft['status']): LocalDraft => ({
  key: handle,
  accountId: 'owner',
  generation: 'generation',
  revision: 2,
  acknowledgedRevision: 2,
  draftId: handle,
  serverDraftId: serverId,
  threadId: 'local-thread',
  serverThreadId: 'server-thread',
  content: { subject: 'Stale local subject' },
  attachments: [],
  status,
  updatedAt: 1,
});

it('returns the durable working copy while CRM proof is unavailable', async () => {
  await setup();
  mocks.proofCurrent = false;
  const local = workingCopy('dirty');
  vi.mocked(readLocalDraft).mockResolvedValue(local);
  expect(await readEmailDraft(serverId)).toMatchObject({ local });
  expect(mocks.readRecordsByKeys).toHaveBeenCalled();
  expect(localDraftMessage).toHaveBeenCalledWith(local);
  expect(restoreLocalAttachments).toHaveBeenCalledWith(local);
});

it('propagates an unavailable cache when no working copy exists', async () => {
  await setup();
  mocks.proofCurrent = false;
  const denied = new StaleCacheAuthorityError();
  mocks.readRecordsByKeys.mockRejectedValue(denied);
  await expect(readEmailDraft(serverId)).rejects.toBe(denied);
  expect(mocks.readRecordsByKeys).toHaveBeenCalledOnce();
});

it('drops a synced working copy from its cached thread when the discard is enqueued', async () => {
  const { operations } = await setup();
  vi.mocked(readLocalDraft).mockResolvedValue(workingCopy('synced'));
  expect(
    await deleteEmailDraftQueued({
      draftId: serverId,
      threadId: 'local-thread',
    })
  ).toEqual({ kind: 'queued' });
  const operation = operations[0];
  const response = optimisticContextOf(operation)!
    .optimisticResponse as DeleteEmailDraftMutation;
  expect(operation.variables?.input.draftId).toBe(handle);
  expect(response.deleteEmailDraft).toMatchObject({
    threadDeleted: true,
    thread: {
      isDraft: false,
      mailDraftPreview: null,
      messages: [],
      mailDraftState: { drafts: [] },
    },
  });
});

it('reads authoritative content once the local working copy is synced', async () => {
  const { draftResult } = await setup();
  const cached = draftResult();
  cached.records[0].record.subject = 'New edit from another device';
  vi.mocked(readLocalDraft).mockResolvedValue(workingCopy('synced'));
  mocks.readRecordsByKeys.mockResolvedValue(cached);
  const result = await readEmailDraft(serverId);
  expect(result?.draft?.subject).toBe('New edit from another device');
  expect(restoreLocalAttachments).not.toHaveBeenCalled();
});

it('keeps a confirmed server identity while attachment receipts are pending', async () => {
  await setup();
  const local = workingCopy('dirty');
  local.attachments = [
    {
      type: 'local',
      id: 'file',
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 1,
      lastModified: 0,
      uploaded: false,
    },
  ];
  vi.mocked(readLocalDraft).mockResolvedValue(local);
  mocks.readRecordsByKeys.mockResolvedValue({ revision: '1', records: [] });
  expect(await readEmailDraft(serverId)).toMatchObject({
    persistence: 'committed',
    local,
  });
  expect(localDraftMessage).toHaveBeenCalledWith(local);
});

it('does not reopen unsynced content over an authoritative sent record', async () => {
  const { draftResult } = await setup();
  const cached = draftResult();
  cached.records[0].record.isDraft = false;
  cached.records[0].record.isSent = true;
  vi.mocked(readLocalDraft).mockResolvedValue(workingCopy('failed'));
  mocks.readRecordsByKeys.mockResolvedValue(cached);
  expect((await readEmailDraft(serverId))?.draft).toBeUndefined();
  expect(restoreLocalAttachments).not.toHaveBeenCalled();
});

it('reads a restored generation over an older accepted cache record', async () => {
  const { draftResult } = await setup();
  const cached = draftResult();
  cached.records[0].record.isDraft = false;
  cached.records[0].record.isSent = false;
  cached.records[0].record.draftGeneration = 1;
  const local = workingCopy('dirty');
  local.content.draft_generation = 2;
  vi.mocked(readLocalDraft).mockResolvedValue(local);
  mocks.readRecordsByKeys.mockResolvedValue(cached);
  expect(await readEmailDraft(serverId)).toMatchObject({ local });
  expect(localDraftMessage).toHaveBeenCalledWith(local);
  expect(restoreLocalAttachments).toHaveBeenCalledWith(local);
});

it('keeps a newer server send authoritative over a restored working copy', async () => {
  const { draftResult } = await setup();
  const cached = draftResult();
  cached.records[0].record.isDraft = false;
  cached.records[0].record.isSent = true;
  cached.records[0].record.draftGeneration = 3;
  const local = workingCopy('dirty');
  local.content.draft_generation = 2;
  vi.mocked(readLocalDraft).mockResolvedValue(local);
  mocks.readRecordsByKeys.mockResolvedValue(cached);
  expect((await readEmailDraft(serverId))?.draft).toBeUndefined();
  expect(restoreLocalAttachments).not.toHaveBeenCalled();
});

it('returns the working copy when cache initialization fails during the status read', async () => {
  await setup();
  const local = workingCopy('dirty');
  vi.mocked(readLocalDraft).mockResolvedValue(local);
  mocks.readRecordsByKeys.mockRejectedValue(
    new Error('cache bootstrap failed')
  );
  expect(await readEmailDraft(serverId, { attachments: false })).toMatchObject({
    local,
  });
});

/** The first reply, approved on this device and not yet delivered. */
const delivering: EmailSendIntent = {
  uuid: 'attempt',
  dispatchVersion: 2,
  phase: 'committed',
  locallyCancelled: false,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      input: {
        attempt: { attemptId: 'attempt', linkId: 'inbox' },
        message: { draftId: 'first-reply', subject: 'Re: Plan' },
        attachmentIds: [],
        forwardedAttachmentIds: [],
      },
      draft: {
        draftId: 'first-reply',
        threadDbId: 'server-thread',
        subject: 'Re: Plan',
        senderEmail: 'sender@example.com',
        senderLinkId: 'inbox',
        optimisticBodyHtml: null,
      },
    },
  },
};

it('holds a reply to a message still being delivered and saves it once that settles', async () => {
  const { operations } = await setup();
  let sendsChanged = () => {};
  vi.mocked(watchLocalEmailSends).mockImplementation((changed) => {
    sendsChanged = changed;
    return () => {};
  });
  vi.mocked(readLocalEmailSends).mockResolvedValue([delivering]);
  vi.mocked(readLocalDraft).mockResolvedValue(workingCopy('dirty'));
  const followUp = { ...args, replyingToId: 'first-reply' };

  expect(await saveEmailDraftQueued({ args: followUp })).toEqual({
    kind: 'queued',
  });
  sendsChanged();
  await vi.waitFor(() => expect(readLocalEmailSends).toHaveBeenCalledTimes(2));
  expect(operations).toEqual([]);

  vi.mocked(readLocalEmailSends).mockResolvedValue([]);
  sendsChanged();
  await vi.waitFor(() => expect(operations).toHaveLength(1));
  expect(operations[0].variables?.input.replyingToId).toBe('first-reply');
});

it('drops a held reply save once the reply itself was sent or discarded', async () => {
  const { operations } = await setup();
  let sendsChanged = () => {};
  vi.mocked(watchLocalEmailSends).mockImplementation((changed) => {
    sendsChanged = changed;
    return () => {};
  });
  vi.mocked(readLocalEmailSends).mockResolvedValue([delivering]);
  await saveEmailDraftQueued({
    args: { ...args, replyingToId: 'first-reply' },
  });

  vi.mocked(readLocalEmailSends).mockResolvedValue([]);
  vi.mocked(readLocalDraft).mockResolvedValue(undefined);
  sendsChanged();
  await vi.waitFor(() => expect(readLocalDraft).toHaveBeenCalledTimes(2));
  expect(operations).toEqual([]);
});

it('does not report a save that lost to its own send', async () => {
  const operations: Operation[] = [];
  mocks.client = createClient({
    url: 'http://example.test/graphql',
    exchanges: [
      () => (source) =>
        pipe(
          source,
          map((operation) => {
            operations.push(operation);
            return {
              operation,
              stale: false,
              hasNext: false,
              error: new CombinedError({
                graphQLErrors: [
                  {
                    message: 'cancel scheduled delivery before editing',
                    extensions: { code: 'INVALID' },
                  },
                ],
              }),
            };
          })
        ),
    ],
  });
  mocks.readRecordsByKeys.mockResolvedValue({ revision: '1', records: [] });
  vi.mocked(emailSendOwnsDraft).mockResolvedValue(true);

  expect(await saveEmailDraftQueued({ args })).toEqual({ kind: 'queued' });
  expect(operations).toHaveLength(1);
  expect(toast.failure).not.toHaveBeenCalled();

  vi.mocked(emailSendOwnsDraft).mockResolvedValue(false);
  expect(await saveEmailDraftQueued({ args })).toEqual({
    kind: 'rejected',
    code: 'INVALID',
  });
  expect(toast.failure).toHaveBeenCalledOnce();
});

it('queues nothing for a draft that is being discarded', async () => {
  const { operations } = await setup();
  vi.mocked(readLocalDraft).mockResolvedValue(workingCopy('deleting'));
  // A closed composer's last flush arrives after the discard.
  vi.mocked(beginDraftAttempt).mockResolvedValue(undefined);

  expect(await saveEmailDraftQueued({ args })).toEqual({ kind: 'queued' });
  expect(operations).toEqual([]);
  expect(Telemetry.info).toHaveBeenCalledExactlyOnceWith(
    'email_draft.save_yielded_to_discard',
    { 'email_draft.draft_id': handle }
  );
});

it('discards a copied thread when a cached draft read crosses revocation', async () => {
  const { draftResult, threadResult } = await setup();
  const releases: Array<() => void> = [];
  mocks.readRecordsByKeys.mockImplementation(
    ({ keys }: { keys: string[] }) =>
      new Promise((resolve) => {
        releases.push(() =>
          resolve(
            keys[0].startsWith('GraphqlSoupEmailMessage:')
              ? draftResult()
              : threadResult()
          )
        );
      })
  );
  const read = readCachedDraftAndThread(handle, 'local-thread');
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  const retirement = Promise.withResolvers<void>();
  const transition = cacheSessionGeneration.transition(
    () => retirement.promise
  );
  try {
    releases.forEach((release) => release());
    expect(await read).toMatchObject({
      existingThread: undefined,
      existingDraft: undefined,
    });
  } finally {
    retirement.resolve();
    await transition;
  }
});

it('does not reuse a pre-save thread binding when committed content is unavailable', async () => {
  const { operations } = await setup(true, true);
  const local = { ...workingCopy('dirty'), serverThreadId: 'previous-thread' };
  vi.mocked(readLocalDraft).mockResolvedValue(local);
  await expect(saveEmailDraftQueued({ args })).resolves.toEqual({
    kind: 'queued',
  });
  // The draft moved since the journal recorded its last thread. This save's
  // accepted result has no payload confirming where it finally landed.
  expect(operations[0].variables?.input.threadDbId).toBe('server-thread');
  expect(markDraftAttemptQueued).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'attempt' })
  );
  await expect(
    saveEmailDraftQueued({ args: { ...args, subject: 'Next authored edit' } })
  ).resolves.toEqual({ kind: 'queued' });
  expect(operations).toHaveLength(2);
  expect(refetchSoupEntity).not.toHaveBeenCalled();
  expect(toast.failure).not.toHaveBeenCalled();
});

it('keeps legacy saves accepted and completes deletes when committed content is unavailable', async () => {
  await setup(true, true);
  await expect(saveEmailDraftQueued({ args })).resolves.toEqual({
    kind: 'queued',
  });
  await expect(
    deleteEmailDraftQueued({ draftId: handle, threadId: 'local-thread' })
  ).resolves.toEqual({ kind: 'committed' });
  expect(toast.failure).not.toHaveBeenCalled();
});

it.each([false, true])(
  'keeps a committed save accepted without rereading its journal (journal: %s)',
  async (hasJournal) => {
    const { operations } = await setup(true, true);
    const failure = new Error('Draft journal unavailable');
    vi.mocked(readLocalDraft)
      .mockResolvedValueOnce(hasJournal ? workingCopy('dirty') : undefined)
      .mockRejectedValueOnce(failure);
    mocks.readRecordsByKeys.mockRejectedValue(new StaleCacheAuthorityError());
    await expect(saveEmailDraftQueued({ args })).resolves.toEqual({
      kind: 'queued',
    });
    expect(readLocalDraft).toHaveBeenCalledTimes(1);
    expect(toast.failure).not.toHaveBeenCalled();
    expect(operations).toHaveLength(1);
  }
);
