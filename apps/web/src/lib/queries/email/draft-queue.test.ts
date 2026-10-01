import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import type { MutationSettlement } from '@graphql-cache/protocol';
import type {
  DeleteEmailDraftMutation,
  SaveEmailDraftMutation,
} from '@service-storage/graphql/generated/graphql';
import { type Client, createClient, type Operation } from '@urql/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';

const mocks = vi.hoisted(() => ({
  readRecordsByKeys: vi.fn(),
  onCacheChanged: vi.fn(),
  onMutationSettled: vi.fn(),
  client: undefined as Client | undefined,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: 'graphql-soup',
  isFeatureEnabled: () => true,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () => ({
    readRecordsByKeys: mocks.readRecordsByKeys,
    onCacheChanged: mocks.onCacheChanged,
    onMutationSettled: mocks.onMutationSettled,
  }),
  getGraphqlSoupClient: () => mocks.client,
  graphqlCacheEnabled: () => true,
}));
vi.mock('../client', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../soup/cache', () => ({
  invalidateAllSoup: vi.fn(),
  invalidateSoupEntity: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));
vi.mock('./draft-cache', () => ({ markThreadDraftSaved: vi.fn() }));
vi.mock('./thread', () => ({ fetchAndCacheThread: vi.fn() }));

import {
  deleteEmailDraftQueued,
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
});

async function setup() {
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
              extensions: {
                normalizedCacheMutationDisposition: {
                  kind: 'queued',
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
