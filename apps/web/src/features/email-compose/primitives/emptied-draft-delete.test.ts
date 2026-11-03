import 'fake-indexeddb/auto';
import { CombinedError, createClient, type Operation } from '@urql/core';
import { IDBFactory } from 'fake-indexeddb';
import { Kind } from 'graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';
import {
  DraftPersistRejected,
  type EmailInbox,
  type SaveEmailDraft,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { EmailRecipient } from '../core/email-recipient';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

const network = vi.hoisted(() => ({
  client: undefined as unknown,
  uncertainDelete: false,
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
  network.uncertainDelete = false;
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
                  if (network.uncertainDelete)
                    return {
                      operation,
                      stale: false,
                      hasNext: false,
                      error: new CombinedError({
                        networkError: new Error(
                          'cache storage changed during enqueue'
                        ),
                      }),
                    };
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
const saysIn = (save: SaveEmailDraft, text: string) =>
  decodeBase64Utf8(save.draft.body_html ?? '').includes(text);

async function waitForSave(
  saves: SaveEmailDraft[],
  matches: (save: SaveEmailDraft) => boolean
) {
  return await vi.waitFor(
    () => {
      const save = saves.find(matches);
      expect(save).toBeDefined();
      return save!;
    },
    { timeout: 3_000 }
  );
}

/** Edits are kept on the device and no local-save failure was shown. */
async function expectSavedLocally(
  state: { localSaveState(): 'saving' | 'saved' | 'failed' },
  failure: ReturnType<typeof vi.fn>
) {
  await vi.waitFor(() => expect(state.localSaveState()).toBe('saved'), {
    timeout: 3_000,
  });
  expect(
    failure.mock.calls.filter(
      ([message]) => message === 'Draft could not be saved on this device'
    )
  ).toEqual([]);
}

/** A slow delete outlasts the composer's 500 ms autosave debounce. */
const outlastAutosaveDebounce = () =>
  new Promise((resolve) => setTimeout(resolve, 700));

const timedOutCacheRead = async () => {
  throw new Error('cache worker timeout: read-records-by-keys');
};

const unqueuedDeletes = providers.flatMap(([provider, inbox]) => [
  [
    provider,
    'its cache read timed out',
    inbox,
    () => {
      network.readRecordsByKeys = timedOutCacheRead;
    },
  ] as const,
  [
    provider,
    'its enqueue outcome was uncertain',
    inbox,
    () => {
      network.uncertainDelete = true;
    },
  ] as const,
]);

/** Type, then clear every field so the composer deletes the draft it saved. */
async function emptySavedDraft(
  root: ReturnType<typeof mountEmailComposer>,
  saves: SaveEmailDraft[]
) {
  root.edit('First version', '');
  const first = await waitForSave(saves, (save) =>
    saysIn(save, 'First version')
  );
  root.edit('', '');
  root.state.context.setRecipients('to', []);
  return first.clientHandles!.draftId;
}

async function emptySavedReply(
  reply: ReturnType<typeof mountReplyComposer>,
  saves: SaveEmailDraft[]
) {
  reply.edit('First version');
  const first = await waitForSave(saves, (save) =>
    saysIn(save, 'First version')
  );
  reply.edit('');
  return first.clientHandles!.draftId;
}

it.each(providers)(
  'keeps a recipient added on %s while the emptied draft is still being deleted',
  async (_provider, inbox) => {
    const { context, saves, deleteSent, answerDelete } =
      createQueueContext(inbox);
    const root = mountEmailComposer(context);
    try {
      const emptied = await emptySavedDraft(root, saves);
      await deleteSent;
      root.state.context.setRecipients('to', [recipient('new@example.com')]);
      await outlastAutosaveDebounce();
      answerDelete();

      await expectSavedLocally(
        root.state,
        vi.mocked(context.notices.feedback.failure)
      );
      const saved = await waitForSave(saves, (save) =>
        addressedTo(save, 'new@example.com')
      );
      const draftId = saved.clientHandles!.draftId;
      expect(draftId).not.toBe(emptied);
      expect(await localDrafts.readLocalDraft(draftId)).toMatchObject({
        content: {
          to: [expect.objectContaining({ email: 'new@example.com' })],
        },
      });
    } finally {
      root.dispose();
    }
  }
);

it.each(unqueuedDeletes)(
  "keeps a recipient added on %s after the emptied draft's delete failed because %s",
  async (_provider, _failure, inbox, failDelete) => {
    const { context, saves } = createQueueContext(inbox);
    failDelete();
    const root = mountEmailComposer(context);
    try {
      const emptied = await emptySavedDraft(root, saves);
      await vi.waitFor(() =>
        expect(context.notices.feedback.failure).toHaveBeenCalledWith(
          'Failed to delete draft'
        )
      );
      root.state.context.setRecipients('to', [recipient('new@example.com')]);

      await expectSavedLocally(
        root.state,
        vi.mocked(context.notices.feedback.failure)
      );
      const saved = await waitForSave(saves, (save) =>
        addressedTo(save, 'new@example.com')
      );
      expect(saved.clientHandles?.draftId).toBe(emptied);
      expect(await localDrafts.readLocalDraft(emptied)).toMatchObject({
        content: {
          to: [expect.objectContaining({ email: 'new@example.com' })],
        },
      });
    } finally {
      root.dispose();
    }
  }
);

it.each(providers)(
  'keeps reply text typed on %s while the emptied reply is still being deleted',
  async (_provider, inbox) => {
    const { context, saves, deleteSent, answerDelete } =
      createQueueContext(inbox);
    const reply = mountReplyComposer(context);
    try {
      const emptied = await emptySavedReply(reply, saves);
      await deleteSent;
      reply.edit('Second version');
      await outlastAutosaveDebounce();
      answerDelete();

      await expectSavedLocally(
        reply,
        vi.mocked(context.notices.feedback.failure)
      );
      const saved = await waitForSave(saves, (save) =>
        saysIn(save, 'Second version')
      );
      const draftId = saved.clientHandles!.draftId;
      expect(draftId).not.toBe(emptied);
      const local = await localDrafts.readLocalDraft(draftId);
      expect(decodeBase64Utf8(local?.content.body_html ?? '')).toContain(
        'Second version'
      );
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'keeps reply text typed on %s after the emptied reply could not be queued for deletion',
  async (_provider, inbox) => {
    const { context, saves } = createQueueContext(inbox);
    network.readRecordsByKeys = timedOutCacheRead;
    const reply = mountReplyComposer(context);
    try {
      const emptied = await emptySavedReply(reply, saves);
      await vi.waitFor(() =>
        expect(context.notices.feedback.failure).toHaveBeenCalledWith(
          'Failed to delete draft'
        )
      );
      reply.edit('Second version');

      await expectSavedLocally(
        reply,
        vi.mocked(context.notices.feedback.failure)
      );
      const saved = await waitForSave(saves, (save) =>
        saysIn(save, 'Second version')
      );
      expect(saved.clientHandles?.draftId).toBe(emptied);
      const local = await localDrafts.readLocalDraft(emptied);
      expect(decodeBase64Utf8(local?.content.body_html ?? '')).toContain(
        'Second version'
      );
    } finally {
      reply.dispose();
    }
  }
);
