import 'fake-indexeddb/auto';
import type { EmailDraftStorage } from '@app/features/email-compose/context/compose-capabilities';
import type { DraftSyncViewState } from '@app/features/email-compose/core/local-draft';
import { fireAndForget } from '@core/util/fireAndForget';
import { createFakeWebLocks } from '@graphql-cache/exchange/fake-web-locks';
import type { CacheHost } from '@graphql-cache/host/types';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import { createQueue } from './draft-sync-queue';
import { createServer, Refusal, wait } from './draft-sync-server';
import { ACCOUNT, INBOX, never, SENDER } from './draft-sync-shared';

export type { Fault, ServerRequest } from './draft-sync-server';

/**
 * The email draft client, run whole against a simulated server.
 *
 * Real: the composer's session, persistence, autosave and sync status
 * primitives, the draft queue, the working-copy store on IndexedDB, the
 * normalized cache exchange with its mutation queue runner and draft
 * lifecycle, the send journal, dispatcher and recovery, and urql's fetch
 * transport. Simulated: the server, the cache engine's durable queue, and time.
 *
 * `reload()` replaces every module with a fresh instance over the same disk
 * and queue, as a page reload does, and abandons the old page mid-flight.
 */

// fake-indexeddb schedules its work here, outside the fake clock.
const realSetImmediate = setImmediate;

/** Wait for work whose failure someone else reports, or nobody is left to. */
async function quietly(work: Promise<unknown>) {
  try {
    await work;
  } catch {
    // The caller awaits the same promise, or its page is gone.
  }
}

export type WorldEvent =
  | { kind: 'toast'; at: number; message: string }
  | { kind: 'banner'; at: number; draftId?: string; state: DraftSyncViewState }
  | { kind: 'sync-failed'; at: number; attributes: Record<string, unknown> }
  | { kind: 'error'; at: number; message: string };

/**
 * Generated documents hold no state and are most of a page's memory, so every
 * page shares the first page's copy instead of evaluating its own.
 */
const STATELESS_MODULES = ['@service-storage/graphql/generated/graphql'];
const stateless = new Map<string, unknown>();

type Page = Awaited<ReturnType<typeof boot>>;
export type Composer = ReturnType<Page['compose']>;

async function boot(world: WorldCore) {
  const page = { alive: true };
  vi.resetModules();
  const record = (event: WorldEvent) => {
    if (page.alive) world.events.push(event);
  };
  const failure = (message: unknown) =>
    record({ kind: 'toast', at: Date.now(), message: String(message) });
  const runtime: {
    client?: unknown;
    host?: CacheHost;
    CombinedError?: typeof import('@urql/core').CombinedError;
  } = {};

  for (const id of STATELESS_MODULES) {
    const shared = stateless.get(id);
    if (shared) vi.doMock(id, () => shared);
  }
  vi.doMock('@core/component/Toast/Toast', () => ({
    toast: {
      failure,
      alert: failure,
      success: () => undefined,
      custom: (content: { title?: unknown }) => failure(content.title),
      dismiss: () => undefined,
    },
  }));
  vi.doMock('@core/constant/featureFlags', () => ({
    enableGraphqlSoup: {},
    isFeatureEnabled: () => true,
  }));
  vi.doMock('@app/lib/analytics', () => ({
    analytics: { track: () => {}, posthog: { captureException: () => {} } },
  }));
  vi.doMock('@core/util/platform', () => ({ isTauri: () => false }));
  vi.doMock('@core/mobile/nativeStagedUpload', () => ({
    getNativeStagedUpload: () => undefined,
  }));
  vi.doMock('@queries/client', () => ({
    queryClient: {
      // A page that reloaded can no longer reach its account's storage.
      getQueryData: () =>
        page.alive ? { authenticated: true, id: ACCOUNT } : undefined,
      getQueryState: () => ({ dataUpdatedAt: Number.MAX_SAFE_INTEGER }),
      invalidateQueries: () => {},
    },
  }));
  vi.doMock('@queries/soup/cache', () => ({
    invalidateAllSoup: () => {},
    invalidateSoupEntity: () => {},
    refetchSoupEntity: async () => {},
  }));
  vi.doMock('@queries/soup/graphql/active-queries', () => ({
    getUnmaintainedGraphqlSoupRevalidations: () => [],
    refreshActiveGraphqlSoupQueries: async () => {},
  }));
  vi.doMock('@queries/email/draft-cache', () => ({
    markThreadDraftSaved: () => {},
  }));
  vi.doMock('@queries/email/thread', () => ({
    fetchAndCacheThread: async () => undefined,
  }));
  vi.doMock('@queries/email/send-telemetry', () => ({
    emailSendFailureKind: () => 'unknown',
    recordEmailSend: () => {},
    trackEmailMessageSent: () => {},
    traceEmailSend: (_name: string, _attempt: unknown, work: () => unknown) =>
      work(),
  }));
  vi.doMock('@service-storage/graphql-soup', () => ({
    getGraphqlSoupClient: () => runtime.client,
    getGraphqlCacheHost: () => runtime.host,
    graphqlCacheEnabled: () => true,
    graphqlDraftQueueBlocked: () => false,
    assertEmailDraftQueueAvailable: () => {},
    graphqlCacheRecoveryState: () => 'ready',
    retryGraphqlCacheInitialization: async () => {},
  }));
  const send = async (
    operation: string,
    input: unknown,
    signal: AbortSignal
  ): Promise<unknown> => {
    if (!page.alive) return await never();
    world.activity();
    const CombinedError = runtime.CombinedError!;
    try {
      const result = await world.server.handle(operation, input, page, signal);
      if ('status' in result)
        throw new CombinedError({
          networkError: new Error(`HTTP ${result.status}`),
          response: new Response(null, { status: result.status }),
        });
      return result.data;
    } catch (error) {
      if (!page.alive) return await never();
      if (error instanceof Refusal)
        throw new CombinedError({
          graphQLErrors: [
            { message: error.message, extensions: { code: error.code } },
          ],
        });
      if (error instanceof CombinedError) throw error;
      throw new CombinedError({ networkError: error as Error });
    }
  };
  vi.doMock('@service-storage/email-send', () => ({
    submitEmailSend: (input: unknown, signal: AbortSignal) =>
      send('SendEmailMessage', input, signal),
    cancelEmailSend: (input: unknown, signal: AbortSignal) =>
      send('CancelEmailSend', input, signal),
    readEmailSendStatus: (input: unknown, signal: AbortSignal) =>
      send('EmailSendAttempt', input, signal),
  }));

  for (const id of STATELESS_MODULES)
    if (!stateless.has(id)) stateless.set(id, { ...(await import(id)) });
  const solid = await import('solid-js');
  const urql = await import('@urql/core');
  runtime.CombinedError = urql.CombinedError;
  const { Telemetry } = await import('@macro-inc/observability');
  vi.spyOn(Telemetry, 'warn').mockImplementation(((
    name: string,
    attributes: Record<string, unknown>
  ) => {
    if (name === 'email_draft.sync_failed')
      record({ kind: 'sync-failed', at: Date.now(), attributes });
  }) as never);
  vi.spyOn(Telemetry, 'error').mockImplementation(((error: unknown) => {
    record({
      kind: 'error',
      at: Date.now(),
      message: error instanceof Error ? error.message : String(error),
    });
  }) as never);
  const { normalizedCacheExchange } = await import(
    '@graphql-cache/exchange/normalized-cache-exchange'
  );
  const { shouldRetryGraphqlMutation } = await import(
    '@service-storage/graphql-mutation-retry'
  );
  const drafts = await import('@queries/email/local-drafts');
  const queue = await import('@queries/email/draft-queue');
  const sends = await import('@queries/email/send-queue');
  const { createEmailSendDispatcher } = await import(
    '@queries/email/email-send-dispatcher'
  );
  const { createEmailSendRecovery } = await import(
    '@queries/email/email-send-recovery'
  );
  const emailSend = await import('@service-storage/email-send');
  const { queuedDraftSaveArgs } = await import(
    '@app/features/email-compose/queries/queued-draft'
  );
  const { DraftPersistRejected } = await import(
    '@app/features/email-compose/context/compose-capabilities'
  );
  const { createDraftSession } = await import(
    '@app/features/email-compose/primitives/draft-session'
  );
  const { createDraftPersistence, deleteDraftForDiscard } = await import(
    '@app/features/email-compose/primitives/draft-persistence'
  );
  const { createDraftAutosave } = await import(
    '@app/features/email-compose/primitives/draft-autosave'
  );
  const { createDraftSyncStatus } = await import(
    '@app/features/email-compose/primitives/draft-sync-status'
  );

  // The queue runner tells whether another page is alive by its Web Lock.
  Object.defineProperty(navigator, 'locks', {
    value: world.locks.forPage(page),
    configurable: true,
  });
  const host = world.queue.connect(page);
  runtime.host = host;
  const lifecycle = drafts.localDraftQueueLifecycle(host);
  const fetchDrafts: typeof fetch = async (_input, init) => {
    if (!page.alive) return await never();
    world.activity();
    const body = JSON.parse(String(init?.body));
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    try {
      const result = await world.server.handle(
        body.operationName,
        body.variables?.input,
        page,
        init?.signal
      );
      if ('status' in result)
        return new Response('upstream unavailable', { status: result.status });
      return json(result);
    } catch (error) {
      if (!page.alive) return await never();
      if (error instanceof Refusal)
        return json({
          data: null,
          errors: [
            { message: error.message, extensions: { code: error.code } },
          ],
        });
      throw error;
    }
  };
  runtime.client = urql.createClient({
    url: 'http://storage.test/graphql',
    preferGetMethod: false,
    fetch: fetchDrafts,
    exchanges: [
      normalizedCacheExchange(host, {
        ...lifecycle,
        // Slow device storage delays every hook that reads the working copy.
        async beforeMutationAttempt(mutation) {
          if (world.localStallMs) await wait(world.localStallMs);
          return await lifecycle.beforeMutationAttempt!(mutation);
        },
        shouldRetryMutation: shouldRetryGraphqlMutation,
      }),
      urql.fetchExchange,
    ],
  });

  // The app shell's outbox: `outbox-session.ts` without its account wiring.
  const storage = await drafts.emailStorageSession();
  const dispatcher = createEmailSendDispatcher({
    session: storage,
    journal: drafts.localDraftStore,
    submit: (intent, signal) =>
      emailSend.submitEmailSend(intent.metadata.payload.input, signal),
    cancel: (intent, signal) =>
      emailSend.cancelEmailSend(intent.metadata.payload.input.attempt, signal),
    status: (intent, signal) =>
      emailSend.readEmailSendStatus(
        intent.metadata.payload.input.attempt,
        signal
      ),
    report: () => {},
  });
  const recovery = createEmailSendRecovery(ACCOUNT);
  const stopActivity = drafts.localDraftStore.subscribe(world.activity);
  const disposers: (() => void)[] = [];

  /** What `compose-adapter.ts` gives a composer whose drafts ride the queue. */
  const storageCapabilities: Pick<
    EmailDraftStorage,
    | 'syncAvailability'
    | 'recoverSynchronization'
    | 'saveLocalDraft'
    | 'retryDraft'
    | 'readDraft'
    | 'watchDrafts'
    | 'saveDraft'
    | 'deleteDraft'
  > = {
    syncAvailability: () => 'ready' as const,
    recoverSynchronization: async () => {},
    saveLocalDraft: (input) =>
      drafts.saveLocalDraft({
        ...input,
        inboxId: input.inboxId ?? INBOX,
        senderEmail: input.draft.sender_email ?? SENDER,
      }),
    retryDraft: queue.retryEmailDraftSynchronization,
    readDraft: queue.readEmailDraft,
    watchDrafts: queue.watchEmailDrafts,
    async saveDraft({
      completingThread,
      previousThreadId,
      ...input
    }: Parameters<EmailDraftStorage['saveDraft']>[0]) {
      const draftId = input.clientHandles?.draftId ?? input.draft.db_id;
      const threadId =
        input.clientHandles?.threadId ?? input.draft.thread_db_id;
      if (!draftId || !threadId)
        throw new Error('A queued draft is saved under its handles');
      const handles = { draftId, threadId };
      if (!(await drafts.readLocalDraft(handles.draftId)))
        await drafts.saveLocalDraft({
          ...input,
          clientHandles: handles,
          inboxId: INBOX,
          attachments: [],
        });
      const local = await drafts.readLocalDraft(handles.draftId);
      const outcome = await queue.saveEmailDraftQueued({
        args: {
          ...queuedDraftSaveArgs({
            draft: local?.content ?? input.draft,
            handles: local
              ? {
                  draftId: local.draftId,
                  threadId: local.threadId ?? handles.threadId,
                }
              : handles,
            senderLinkId: INBOX,
            senderAccount: { macro_id: `macro|${SENDER}` },
            senderEmail: SENDER,
          }),
          localRevision: local?.revision,
        },
        completingThread,
        previousThreadId,
      });
      if (outcome.kind === 'rejected')
        throw new DraftPersistRejected(outcome.code);
      return outcome.kind === 'queued'
        ? { ...handles, inboxId: INBOX, persistence: 'queued' as const }
        : {
            draftId: outcome.draftId,
            threadId: outcome.threadId,
            inboxId: INBOX,
            persistence: 'committed' as const,
          };
    },
    async deleteDraft({
      completingThread,
      ...input
    }: Parameters<EmailDraftStorage['deleteDraft']>[0]) {
      if (!input.threadId)
        throw new Error('A queued draft is deleted from its thread');
      const outcome = await queue.deleteEmailDraftQueued({
        draftId: input.draftId,
        draftGeneration: input.draftGeneration,
        threadId: input.threadId,
        completingThread,
      });
      if (outcome.kind === 'rejected')
        throw new DraftPersistRejected(outcome.code);
    },
  };

  /**
   * A composer without its editor or form: the reply and standalone
   * controllers' persistence stack, driven the way those controllers drive it.
   */
  function compose(
    seed: {
      /** Reopen this saved draft. */
      draft?: {
        draftId: string;
        threadId?: string;
        text: string;
        generation: number;
        local?: { revision: number; generation: string };
      };
      /** Reply to this message in its thread. */
      reply?: { messageId: string; threadId: string };
    } = {}
  ) {
    let text = seed.draft?.text ?? '';
    let edit = 0;
    let busy = false;
    let serverGeneration = seed.draft?.generation ?? 0;
    const replyThread = seed.reply?.threadId ?? seed.draft?.threadId;
    return solid.createRoot((dispose) => {
      disposers.push(dispose);
      const session = createDraftSession(
        seed.draft
          ? {
              draftId: seed.draft.draftId,
              threadId: seed.draft.threadId,
              persistence: 'queued',
            }
          : undefined
      );
      const snapshot = () => ({
        edit,
        draft: {
          subject: 'Subject',
          to: [{ email: 'you@example.com' }],
          cc: [],
          bcc: [],
          body_text: text,
          body_html: btoa(`<p>${text}</p>`),
          replying_to_id: seed.reply?.messageId,
          thread_db_id: seed.reply ? replyThread : undefined,
          draft_generation: serverGeneration,
        },
      });
      const persistence = createDraftPersistence({
        session,
        draftGeneration: () => serverGeneration,
        drafts: storageCapabilities,
        attachments: { upload: async () => {} },
        mintThreadHandle: !seed.reply,
        localDraft: seed.draft?.local,
        onAlreadySent: () => {},
      });
      const autosave = createDraftAutosave({
        capture: snapshot,
        persist: (captured) =>
          persistence.save({ draft: captured.draft, inboxId: INBOX }),
        saveLocalSnapshot: (captured) =>
          persistence.saveLocally({
            draft: captured.draft,
            inboxId: INBOX,
            attachments: [],
            edit: captured.edit,
          }),
        paused: () => busy,
        // The composers report these; a rejection also latches the session.
        onError: (error) =>
          record({
            kind: 'error',
            at: Date.now(),
            message: `autosave: ${error instanceof Error ? error.message : String(error)}`,
          }),
        onLocalError: (error) => failure(`local save: ${String(error)}`),
      });
      const discard = async () => {
        busy = true;
        autosave.cancel();
        try {
          await autosave.settled().catch(() => {});
          await autosave.flushLocal().catch(() => {});
          const draftId = session.draftId();
          if (draftId)
            await deleteDraftForDiscard(storageCapabilities, {
              draftId,
              draftGeneration: serverGeneration,
              threadId: session.threadId(),
              inboxId: INBOX,
            });
          text = '';
          serverGeneration = 0;
          session.dispatch({ type: 'reset' });
        } finally {
          busy = false;
        }
      };
      const sync = createDraftSyncStatus({
        // The status primitive reads only the capabilities listed above.
        drafts: storageCapabilities as EmailDraftStorage,
        connectivity: { looksOffline: () => world.offline },
        draftId: () => session.draftId() ?? undefined,
        localSaveState: autosave.localSaveState,
        retry: async () => {
          await persistence.retry();
          await autosave.save();
        },
        discard,
      });
      solid.createEffect(() => {
        const state = sync.state();
        if (state)
          record({
            kind: 'banner',
            at: Date.now(),
            draftId: session.draftId() ?? undefined,
            state,
          });
      });
      return {
        draftId: () => session.draftId() ?? undefined,
        text: () => text,
        banner: () => sync.state(),
        type(next: string) {
          text = next;
          edit += 1;
          autosave.schedule();
        },
        /** The Retry button on the sync banner. */
        retry: () => sync.retry(),
        discard,
        /** Send: capture the newest text as the working copy, then queue it. */
        async send() {
          busy = true;
          autosave.cancel();
          try {
            await autosave.settled().catch(() => {});
            await autosave.saveLocal();
            const draftId = session.draftId();
            const threadId = session.threadId();
            if (!draftId || !threadId)
              throw new Error('Nothing to send: the draft has no identity');
            const queued = await sends.sendEmailQueued({
              signatureHtml: '',
              expectedLocalVersion: persistence.localVersion(),
              draft: queuedDraftSaveArgs({
                draft: snapshot().draft,
                handles: { draftId, threadId },
                senderLinkId: INBOX,
                senderAccount: { macro_id: `macro|${SENDER}` },
                senderEmail: SENDER,
              }),
              attachmentIds: [],
              forwardedAttachmentIds: [],
            });
            const sent = { attemptId: queued.sendAttemptId, text, draftId };
            text = '';
            serverGeneration = 0;
            session.dispatch({ type: 'reset' });
            return sent;
          } finally {
            busy = false;
          }
        },
        /** Leaving the thread or closing the window; the copy stays on disk. */
        close: dispose,
      };
    });
  }

  return {
    drafts,
    queue,
    sends,
    compose,
    /** Reopen a draft the way restoration seeds a composer from its copy. */
    async reopen(draftId: string) {
      const local = await drafts.readLocalDraft(draftId);
      if (!local) throw new Error(`No working copy for ${draftId}`);
      return compose({
        draft: {
          draftId: local.draftId,
          threadId: local.threadId,
          text: local.content.body_text ?? '',
          generation: local.content.draft_generation ?? 0,
          local: { revision: local.revision, generation: local.generation },
        },
        reply: local.content.replying_to_id
          ? {
              messageId: String(local.content.replying_to_id),
              threadId: local.threadId ?? '',
            }
          : undefined,
      });
    },
    /** Undo from the send notice. */
    async undo(attemptId: string) {
      const intent = (await sends.readEmailSendIntents()).find(
        (row) => row.uuid === attemptId
      );
      if (!intent) throw new Error(`No queued send ${attemptId}`);
      await sends.cancelEmailSendAndConfirm(intent);
    },
    /** The page goes away mid-flight: nothing it started is heard from again. */
    kill() {
      page.alive = false;
      stopActivity();
      dispatcher.dispose();
      recovery.dispose();
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          // A composer torn down with its page has nobody to report to.
        }
      }
      host.dispose();
      world.locks.release(page);
      fireAndForget(
        quietly(drafts.localDraftStore.close()),
        'draft-sync-world'
      );
    },
  };
}

type WorldCore = {
  server: ReturnType<typeof createServer>;
  queue: ReturnType<typeof createQueue>;
  events: WorldEvent[];
  offline: boolean;
  localStallMs: number;
  locks: ReturnType<typeof createFakeWebLocks>;
  activity(): void;
};

/** A fresh device, server and clock. Call `dispose()` when the test ends. */
export async function createDraftSyncWorld() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
    ],
  });
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  let activity = 0;
  const active = () => {
    activity += 1;
  };
  const core: WorldCore = {
    server: createServer(),
    queue: createQueue(active),
    events: [],
    offline: false,
    localStallMs: 0,
    locks: createFakeWebLocks(),
    activity: active,
  };

  /** Let everything already runnable finish, without moving the clock. */
  async function quiesce() {
    let quiet = 0;
    for (let round = 0; round < 400 && quiet < 6; round++) {
      const before = activity;
      await vi.advanceTimersByTimeAsync(0);
      for (let hop = 0; hop < 4; hop++)
        await new Promise<void>((resolve) => realSetImmediate(resolve));
      quiet = activity === before ? quiet + 1 : 0;
    }
  }
  async function advance(ms: number) {
    await quiesce();
    for (let left = ms; left > 0; left -= 100) {
      await vi.advanceTimersByTimeAsync(Math.min(100, left));
      await quiesce();
    }
  }
  /** Wait for one user action, letting the clock run as far as it needs. */
  async function settle<T>(work: Promise<T>, limitMs = 120_000): Promise<T> {
    let done = false;
    const watch = async () => {
      await quietly(work);
      done = true;
    };
    fireAndForget(watch(), 'draft-sync-world');
    await quiesce();
    for (let waited = 0; !done && waited < limitMs; waited += 50) {
      await vi.advanceTimersByTimeAsync(50);
      await quiesce();
    }
    if (!done) throw new Error(`Still pending after ${limitMs} ms`);
    return await work;
  }

  let page: Page = await boot(core);
  return {
    server: core.server,
    queue: core.queue,
    events: core.events,
    advance,
    settle,
    quiesce,
    get page() {
      return page;
    },
    set offline(value: boolean) {
      core.offline = value;
    },
    set localStallMs(value: number) {
      core.localStallMs = value;
    },
    /** Start something the page will not live to finish. */
    abandon(work: Promise<unknown>) {
      fireAndForget(quietly(work), 'draft-sync-world');
    },
    /** Reload the tab: same disk, same queue, new page. */
    async reload() {
      page.kill();
      page = await boot(core);
      await quiesce();
      return page;
    },
    /**
     * Everything that told the user a draft failed: a failure toast, an alert
     * banner, or a working copy that started needing a manual retry.
     */
    failures: () =>
      core.events.filter(
        (event) =>
          event.kind === 'toast' ||
          event.kind === 'sync-failed' ||
          (event.kind === 'banner' && event.state.failed)
      ),
    errors: () => core.events.filter((event) => event.kind === 'error'),
    async dispose() {
      page.kill();
      await quiesce();
      vi.useRealTimers();
      Reflect.deleteProperty(navigator, 'locks');
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      vi.resetModules();
    },
  };
}

export type DraftSyncWorld = Awaited<ReturnType<typeof createDraftSyncWorld>>;
