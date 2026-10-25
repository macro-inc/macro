import 'fake-indexeddb/auto';
import { createClient, type Operation } from '@urql/core';
import { IDBFactory } from 'fake-indexeddb';
import { Kind } from 'graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';
import {
  DraftPersistRejected,
  type EmailInbox,
  type SaveEmailDraft,
} from '../context/compose-capabilities';
import type { EmailRecipient } from '../core/email-recipient';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';

const network = vi.hoisted(() => ({
  client: undefined as unknown,
  readRecordsByKeys: undefined as unknown as (
    request: unknown
  ) => Promise<unknown>,
}));

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: vi.fn(), posthog: { captureException: vi.fn() } },
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryData: () => ({ authenticated: true, id: 'owner' }),
    invalidateQueries: vi.fn(async () => {}),
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: 'graphql-soup',
  isFeatureEnabled: () => true,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  assertEmailDraftQueueAvailable: () => {},
  getGraphqlCacheHost: () => ({
    readRecordsByKeys: (request: unknown) => network.readRecordsByKeys(request),
  }),
  getGraphqlSoupClient: () => network.client,
  graphqlCacheEnabled: () => true,
  graphqlCacheRecoveryState: () => undefined,
  graphqlDraftQueueBlocked: () => false,
  retryGraphqlCacheInitialization: async () => {},
}));
vi.mock('@queries/soup/cache', () => ({
  invalidateAllSoup: vi.fn(),
  invalidateSoupEntity: vi.fn(),
  refetchSoupEntity: vi.fn(async () => {}),
}));
vi.mock('@queries/email/draft-cache', () => ({
  markThreadDraftSaved: vi.fn(),
}));
vi.mock('@queries/email/thread', () => ({ fetchAndCacheThread: vi.fn() }));

let localDrafts: typeof import('@queries/email/local-drafts');
let draftQueue: typeof import('@queries/email/draft-queue');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  localDrafts = await import('@queries/email/local-drafts');
  draftQueue = await import('@queries/email/draft-queue');
});
afterEach(async () => {
  await localDrafts.localDraftStore.close();
  vi.unstubAllGlobals();
});

const providers: [string, EmailInbox][] = [
  [
    'Gmail',
    {
      id: 'inbox',
      email_address: 'teo@gmail.example',
      provider: 'GMAIL',
      settings: {},
    },
  ],
  [
    'Outlook',
    {
      id: 'inbox',
      email_address: 'teo@outlook.example',
      provider: 'OUTLOOK',
      settings: {},
    },
  ],
];

const recipient = (email: string): EmailRecipient => ({
  kind: 'custom',
  id: `macro|${email}`,
  data: { id: `macro|${email}`, email, invalid: false },
});

const operationName = (operation: Operation) =>
  operation.query.definitions.find(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION
  )?.name?.value;

/**
 * The durable draft queue against IndexedDB working copies. Only the
 * GraphQL transport and the cache worker are fake: a delete waits for the
 * test to answer it, then comes back queued, as a timed-out request does.
 */
function createQueueContext(inbox: EmailInbox) {
  const deleteSent = Promise.withResolvers<void>();
  const deleteAnswered = Promise.withResolvers<void>();
  network.readRecordsByKeys = async () => ({ revision: '1', records: [] });
  network.client = createClient({
    url: 'http://example.test/graphql',
    exchanges: [
      () => (operations$) =>
        pipe(
          operations$,
          filter((operation) => operation.kind === 'mutation'),
          mergeMap((operation) =>
            fromPromise(
              (async () => {
                if (operationName(operation) === 'DeleteEmailDraft') {
                  deleteSent.resolve();
                  await deleteAnswered.promise;
                }
                return {
                  operation,
                  stale: false,
                  hasNext: false,
                  extensions: {
                    normalizedCacheMutationDisposition: {
                      kind: 'queued',
                      transactionId: crypto.randomUUID(),
                    },
                  },
                };
              })()
            )
          )
        ),
    ],
  });

  const context = createComposeContext();
  context.accounts.inboxes = () => [inbox];
  context.drafts.saveLocalDraft = (input) =>
    localDrafts.saveLocalDraft({
      ...input,
      senderEmail: inbox.email_address,
    });
  const saves: SaveEmailDraft[] = [];
  context.drafts.saveDraft = vi.fn(async (input) => {
    saves.push(input);
    return {
      draftId: input.clientHandles?.draftId ?? input.draft.db_id ?? '',
      threadId: input.clientHandles?.threadId ?? input.draft.thread_db_id,
      inboxId: input.inboxId ?? inbox.id,
      persistence: 'queued' as const,
    };
  });
  context.drafts.deleteDraft = vi.fn(async (input) => {
    if (!input.threadId) throw new Error('A new draft has a thread handle');
    const outcome = await draftQueue.deleteEmailDraftQueued({
      draftId: input.draftId,
      draftGeneration: input.draftGeneration,
      threadId: input.threadId,
      completingThread: input.completingThread,
    });
    if (outcome.kind === 'rejected')
      throw new DraftPersistRejected(outcome.code);
  });
  return {
    context,
    saves,
    deleteSent: deleteSent.promise,
    answerDelete: () => deleteAnswered.resolve(),
  };
}

const addressedTo = (save: SaveEmailDraft, email: string) =>
  save.draft.to?.some((contact) => contact.email === email) ?? false;

const localSaveFailures = (failure: ReturnType<typeof vi.fn>) =>
  failure.mock.calls.filter(
    ([message]) => message === 'Draft could not be saved on this device'
  );

/** Type, then clear every field so the composer deletes the draft it saved. */
async function emptySavedDraft(
  root: ReturnType<typeof mountEmailComposer>,
  saves: SaveEmailDraft[]
) {
  root.edit('First version', '');
  await vi.waitFor(() => expect(saves).toHaveLength(1));
  root.edit('', '');
  root.state.context.setRecipients('to', []);
}

it.each(providers)(
  'keeps a recipient added on %s while the emptied draft is still being deleted',
  async (_provider, inbox) => {
    const { context, saves, deleteSent, answerDelete } =
      createQueueContext(inbox);
    const root = mountEmailComposer(context);
    try {
      await emptySavedDraft(root, saves);
      await deleteSent;

      root.state.context.setRecipients('to', [recipient('new@example.com')]);
      await root.state.flushLocal().catch(() => {});
      expect(
        localSaveFailures(vi.mocked(context.notices.feedback.failure))
      ).toEqual([]);
      expect(root.state.localSaveState()).not.toBe('failed');

      answerDelete();
      await vi.waitFor(
        () =>
          expect(
            saves.some((save) => addressedTo(save, 'new@example.com'))
          ).toBe(true),
        { timeout: 3_000 }
      );
      const saved = saves.find((save) => addressedTo(save, 'new@example.com'))!;
      expect(saved.clientHandles?.draftId).not.toBe(
        saves[0].clientHandles?.draftId
      );
      expect(
        await localDrafts.readLocalDraft(saved.clientHandles!.draftId)
      ).toMatchObject({
        content: {
          to: [expect.objectContaining({ email: 'new@example.com' })],
        },
      });
      expect(root.state.localSaveState()).toBe('saved');
      expect(
        localSaveFailures(vi.mocked(context.notices.feedback.failure))
      ).toEqual([]);
    } finally {
      root.dispose();
    }
  }
);

it.each(providers)(
  'keeps a recipient added on %s after the emptied draft could not be queued for deletion',
  async (_provider, inbox) => {
    const { context, saves } = createQueueContext(inbox);
    network.readRecordsByKeys = async () => {
      throw new Error('cache worker timeout: read-records-by-keys');
    };
    const root = mountEmailComposer(context);
    try {
      await emptySavedDraft(root, saves);
      await vi.waitFor(() =>
        expect(context.notices.feedback.failure).toHaveBeenCalledWith(
          'Failed to delete draft'
        )
      );

      root.state.context.setRecipients('to', [recipient('new@example.com')]);
      await vi.waitFor(
        () =>
          expect(
            saves.some((save) => addressedTo(save, 'new@example.com'))
          ).toBe(true),
        { timeout: 3_000 }
      );
      const draftId = saves[0].clientHandles!.draftId;
      expect(await localDrafts.readLocalDraft(draftId)).toMatchObject({
        content: {
          to: [expect.objectContaining({ email: 'new@example.com' })],
        },
      });
      expect(root.state.localSaveState()).toBe('saved');
      expect(
        localSaveFailures(vi.mocked(context.notices.feedback.failure))
      ).toEqual([]);
    } finally {
      root.dispose();
    }
  }
);
