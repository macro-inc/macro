import 'fake-indexeddb/auto';
import { File as NodeFile } from 'node:buffer';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  ClaimedMutation,
  MutationInspection,
} from '@graphql-cache/protocol';
import type { OperationResult } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: { authenticated: true, id: 'owner' } }));
const native = vi.hoisted(() => ({ active: false }));
vi.mock('@core/util/platform', () => ({ isTauri: () => native.active }));
const stagedUpload = vi.hoisted(() =>
  vi.fn<() => { previewSrc: string; size: number } | undefined>()
);
vi.mock('../client', () => ({
  queryClient: { getQueryData: () => auth.user },
}));
vi.mock('@core/mobile/nativeStagedUpload', () => ({
  getNativeStagedUpload: stagedUpload,
}));
let runtime: typeof import('./local-drafts');
const input = (subject = 'Draft') => ({
  draft: { subject },
  clientHandles: { draftId: 'local', threadId: 'thread' },
  attachments: [],
});
const queue: MutationInspection[] = [];
const sends: unknown[] = [];
const host = {
  durableMutationIntents: async () => sends,
  inspectMutations: async () => queue,
  currentStorageGeneration: async () => 'storage',
} as unknown as CacheHost;
const claimed = (
  metadata: ClaimedMutation['clientMetadata']
): ClaimedMutation => ({
  transactionId: 'tx',
  uuid: 'local',
  requiresConfirmation: false,
  leaseGeneration: 'lease',
  query: '',
  attemptCount: 0,
  serverFailureCount: 0,
  clientMetadata: metadata,
  operationName: 'SaveEmailDraft',
  superseded: false,
  variables: { input: { draftId: 'local' } },
});
const success = {
  data: {
    saveEmailDraft: { draftId: 'server', thread: { id: 'server-thread' } },
  },
} as OperationResult;
const failure = {
  error: { graphQLErrors: [{ extensions: { code: 'INVALID' } }] },
} as unknown as OperationResult;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  queue.length = 0;
  sends.length = 0;
  auth.user = { authenticated: true, id: 'owner' };
  stagedUpload.mockReset();
  native.active = false;
  runtime = await import('./local-drafts');
  await runtime.localDraftStore.clear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await runtime.localDraftStore.close();
});

describe('draft queue recovery', () => {
  it('suppresses intermediate offline inbox moves once send owns the final snapshot', async () => {
    let local = await runtime.saveLocalDraft({
      ...input('Switch sender offline'),
      inboxId: 'inbox-a',
    });
    const moves: ClaimedMutation[] = [];
    for (const inboxId of ['inbox-b', 'inbox-c']) {
      local = await runtime.saveLocalDraft({
        ...input('Switch sender offline'),
        inboxId,
        expectedGeneration: local.generation,
        expectedRevision: local.revision,
      });
      moves.push({
        ...claimed(await runtime.beginDraftAttempt(local, 'save')),
        variables: { input: { draftId: 'local', linkId: inboxId } },
      });
    }
    sends.push({
      uuid: 'send',
      metadata: {
        kind: 'email-send-v1',
        payload: {
          draft: { draftId: 'local', senderLinkId: 'inbox-c' },
          workingCopy: local,
        },
      },
    });
    await runtime.forgetLocalDraft(local.key, local);
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    for (const move of moves)
      expect(await lifecycle.beforeMutationAttempt!(move)).toBe(false);
    expect(await runtime.readLocalDraft('local')).toBeUndefined();
  });

  it('resumes newer send-time edits in a fresh generation without losing files or server aliases', async () => {
    vi.stubGlobal('File', NodeFile);
    const original = await runtime.saveLocalDraft(input('Approved send'));
    const stale = await runtime.beginDraftAttempt(original, 'save');
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    await lifecycle.onMutationAttemptResult!(claimed(stale), success, false);
    const file = new File(['Retain these bytes'], 'newer.txt', {
      type: 'text/plain',
    });
    const newer = await runtime.saveLocalDraft({
      draft: { db_id: 'server', subject: 'Newer edits' },
      attachments: [{ type: 'local', file }],
    });

    await runtime.resumeLocalDraft('server', original.generation);
    const resumed = (await runtime.readLocalDraft('local'))!;
    expect(resumed.generation).not.toBe(original.generation);
    expect(resumed).toMatchObject({
      revision: newer.revision,
      serverDraftId: 'server',
      content: { subject: 'Newer edits' },
    });
    await runtime.resumeLocalDraft('local', original.generation);
    expect((await runtime.readLocalDraft('server'))?.generation).toBe(
      resumed.generation
    );

    // An expired RPC can return this verdict after cancellation. Its old
    // generation must not delete the newer recovered content.
    await lifecycle.onMutationAttemptResult!(
      claimed(stale),
      {
        error: {
          graphQLErrors: [{ extensions: { code: 'DRAFT_ALREADY_SENT' } }],
        },
      } as unknown as OperationResult,
      false
    );
    expect(await runtime.readLocalDraft('server')).toEqual(resumed);
    const attachments = await runtime.restoreLocalAttachments(resumed);
    const recovered = attachments[0];
    expect(recovered.type).toBe('local');
    if (recovered.type !== 'local') throw new Error('Missing recovered file');
    expect(await recovered.file.text()).toBe('Retain these bytes');

    const saved = await runtime.saveLocalDraft({
      draft: { db_id: 'server', subject: 'Edited after cancellation' },
      attachments,
      expectedGeneration: resumed.generation,
      expectedRevision: resumed.revision,
    });
    expect(saved.generation).toBe(resumed.generation);
    expect(saved.revision).toBe(resumed.revision + 1);
    await expect(
      runtime.saveLocalDraft({
        ...input('Obsolete editor'),
        expectedGeneration: original.generation,
        expectedRevision: original.revision,
      })
    ).rejects.toThrow();
    expect((await runtime.readLocalDraft('server'))?.content.subject).toBe(
      'Edited after cancellation'
    );
  });
  it.each(['restoring', 'locally-cancelled', 'cancelled'])(
    'syncs newer restored edits before the %s send journal is retired',
    async (state) => {
      const original = await runtime.saveLocalDraft(input('Original'));
      const stale = await runtime.beginDraftAttempt(original, 'save');
      await runtime.forgetLocalDraft('local');
      await runtime.reviveLocalDraft('local');
      const restored = await runtime.saveLocalDraft(input('Restored'));
      await runtime.beginDraftAttempt(restored, 'save');
      const edited = await runtime.saveLocalDraft(input('Newer edit'));
      const saving = await runtime.beginDraftAttempt(edited, 'save');
      sends.push({
        uuid: 'send',
        locallyCancelled: state === 'locally-cancelled',
        metadata: {
          kind: 'email-send-v1',
          payload: {
            draft: { draftId: 'local' },
            workingCopy: original,
            restoring: state === 'restoring',
          },
        },
        response:
          state === 'cancelled'
            ? { cancelEmailSend: { attempt: { status: 'CANCELLED' } } }
            : undefined,
      });
      const lifecycle = runtime.localDraftQueueLifecycle(host);
      expect(await lifecycle.beforeMutationAttempt!(claimed(stale))).toBe(
        false
      );
      expect(await lifecycle.beforeMutationAttempt!(claimed(saving))).toBe(
        true
      );
      await lifecycle.onMutationAttemptResult!(claimed(saving), success, false);
      expect(await runtime.readLocalDraft('local')).toMatchObject({
        generation: restored.generation,
        acknowledgedRevision: edited.revision,
        content: { subject: 'Newer edit' },
      });
    }
  );
  it('does not resurrect or replay an obsolete draft save owned by a send', async () => {
    sends.push({
      uuid: 'send',
      metadata: {
        kind: 'email-send-v1',
        payload: { draft: { draftId: 'local' } },
      },
    });
    const old: MutationInspection = {
      transactionId: 'old-save',
      uuid: 'local',
      operationName: 'SaveEmailDraft',
      query: 'mutation SaveEmailDraft { saveEmailDraft { draftId } }',
      superseded: false,
      variables: { input: { draftId: 'local', subject: 'Old' } },
      optimisticData: {},
    };
    queue.push(old);
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    await lifecycle.prepareMutationQueue!();
    expect(await runtime.readLocalDraft('local')).toBeUndefined();
    expect(
      await lifecycle.beforeMutationAttempt!({
        ...claimed(undefined),
        uuid: 'local',
      })
    ).toBe(false);
    expect(await runtime.readLocalDraft('local')).toBeUndefined();
  });
  it('rejects an old editor generation after discard and Undo reuse the server identity', async () => {
    const serverInput = (subject: string) => ({
      draft: { db_id: 'server', subject },
      attachments: [],
    });
    const original = await runtime.saveLocalDraft(serverInput('Original'));
    await runtime.forgetLocalDraft('server');
    await runtime.reviveLocalDraft('server');
    const revived = await runtime.saveLocalDraft(serverInput('Explicit undo'));
    expect(revived.revision).toBe(original.revision);
    expect(revived.generation).not.toBe(original.generation);

    await expect(
      runtime.saveLocalDraft({
        ...serverInput('Stale editor'),
        expectedRevision: original.revision,
        expectedGeneration: original.generation,
      })
    ).rejects.toThrow();
    expect(await runtime.readLocalDraft('server')).toMatchObject({
      generation: revived.generation,
      revision: revived.revision,
      content: { subject: 'Explicit undo' },
    });
    await expect(
      runtime.saveLocalDraft({
        ...serverInput('Edited after undo'),
        expectedRevision: revived.revision,
        expectedGeneration: revived.generation,
      })
    ).resolves.toMatchObject({
      generation: revived.generation,
      revision: revived.revision + 1,
      content: { subject: 'Edited after undo' },
    });
  });
  it('does not rebase an old editor snapshot onto a newer stored revision', async () => {
    const original = await runtime.saveLocalDraft(input('Original'));
    const latest = await runtime.saveLocalDraft(input('Other tab edited'));
    await expect(
      runtime.saveLocalDraft({
        ...input('Old editor snapshot'),
        expectedRevision: original.revision,
      })
    ).rejects.toThrow('changed while saving');
    expect(await runtime.readLocalDraft('local')).toMatchObject({
      revision: latest.revision,
      content: { subject: 'Other tab edited' },
    });
  });
  it('rejects an older snapshot whose file copy finishes after a newer save', async () => {
    await runtime.saveLocalDraft(input('Original'));
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    stagedUpload.mockReturnValueOnce({ previewSrc: '/staged-file', size: 5 });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        started.resolve();
        return response.promise;
      })
    );
    const older = runtime.saveLocalDraft({
      ...input('Older snapshot'),
      attachments: [{ type: 'local', file: new File(['hello'], 'note.txt') }],
    });
    const rejected = expect(older).rejects.toThrow('changed while saving');
    await started.promise;
    const newer = await runtime.saveLocalDraft(input('Newer snapshot'));
    response.resolve(new Response('hello'));
    await rejected;
    expect(await runtime.readLocalDraft('local')).toMatchObject({
      revision: newer.revision,
      content: { subject: 'Newer snapshot' },
      attachments: [],
    });
  });
  it('wipes a discarded working copy and rejects stale saves through either identity', async () => {
    const draft = await runtime.saveLocalDraft(input());
    const saving = await runtime.beginDraftAttempt(draft, 'save');
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    await lifecycle.onMutationAttemptResult!(claimed(saving), success, false);
    const saved = (await runtime.readLocalDraft('server'))!;
    const deleting = await runtime.beginDraftAttempt(saved, 'delete');
    await lifecycle.onMutationAttemptResult!(
      claimed(deleting),
      { data: { deleteEmailDraft: { deleted: true } } } as OperationResult,
      false
    );
    expect(await runtime.listLocalDrafts()).toEqual([]);
    await expect(
      runtime.saveLocalDraft(input('Stale handle'))
    ).rejects.toThrow();
    await expect(
      runtime.saveLocalDraft({
        draft: { db_id: 'server', subject: 'Stale server identity' },
        attachments: [],
      })
    ).rejects.toThrow();
    expect(await runtime.listLocalDrafts()).toEqual([]);
    await runtime.reviveLocalDraft('server');
    await runtime.saveLocalDraft({
      draft: { db_id: 'server', subject: 'Explicit undo' },
      attachments: [],
    });
    expect((await runtime.readLocalDraft('server'))?.content.subject).toBe(
      'Explicit undo'
    );
  });
  it('keeps modern correlation in the queue without an ever-growing attempt journal', async () => {
    const draft = await runtime.saveLocalDraft(input());
    await runtime.beginDraftAttempt(draft, 'save');
    const owner = await runtime.localDraftStore.activate('owner');
    expect(await runtime.localDraftStore.attempts(owner)).toEqual([]);
  });
  it('does not mistake another tab’s live debounce for a lost save', async () => {
    await runtime.saveLocalDraft(input());
    await runtime.localDraftQueueLifecycle(host).prepareMutationQueue!();
    expect((await runtime.readLocalDraft('local'))?.status).toBe('dirty');
  });
  it('does not reject an intent still crossing the local-to-queue admission gap', async () => {
    const draft = await runtime.saveLocalDraft(input());
    await runtime.beginDraftAttempt(draft, 'save');
    await runtime.localDraftQueueLifecycle(host).prepareMutationQueue!();
    expect((await runtime.readLocalDraft('local'))?.status).toBe('dirty');
  });
  it('marks an abandoned queued intent recoverable after restart', async () => {
    const draft = await runtime.saveLocalDraft(input());
    const attempt = await runtime.beginDraftAttempt(draft, 'save');
    await runtime.markDraftAttemptQueued(attempt);
    await runtime.localDraftQueueLifecycle(host).prepareMutationQueue!();
    expect((await runtime.readLocalDraft('local'))?.status).toBe('unconfirmed');
  });
  it('does not let an old save overwrite a newer discard intent', async () => {
    const draft = await runtime.saveLocalDraft(input());
    const saving = await runtime.beginDraftAttempt(draft, 'save');
    await runtime.beginDraftAttempt(draft, 'delete');
    await runtime.localDraftQueueLifecycle(host).onMutationAttemptResult!(
      claimed(saving),
      success,
      false
    );
    expect(await runtime.readLocalDraft('local')).toMatchObject({
      status: 'deleting',
      serverDraftId: 'server',
      acknowledgedRevision: draft.revision,
    });
  });
  it('does not acknowledge later edits or let an old result clear newer failure', async () => {
    const first = await runtime.saveLocalDraft(input('First'));
    const saving = await runtime.beginDraftAttempt(first, 'save');
    const second = await runtime.saveLocalDraft(input('Second'));
    const newer = await runtime.beginDraftAttempt(second, 'save');
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    await lifecycle.onMutationAttemptResult!(claimed(newer), failure, false);
    await lifecycle.onMutationAttemptResult!(claimed(saving), success, false);
    expect(await runtime.readLocalDraft('local')).toMatchObject({
      status: 'failed',
      revision: second.revision,
      acknowledgedRevision: first.revision,
      content: { subject: 'Second' },
    });
  });
  it('preserves legacy attachment references and sender before replay', async () => {
    queue.push({
      transactionId: 'legacy',
      uuid: 'local',
      query: '',
      operationName: 'SaveEmailDraft',
      superseded: false,
      variables: {
        input: { draftId: 'local', threadDbId: 'thread', subject: 'Legacy' },
      },
      optimisticData: {
        saveEmailDraft: {
          draft: {
            from: { email: 'sender@example.com' },
            attachmentsDraft: [
              {
                id: 'attachment',
                fileName: 'report.pdf',
                contentType: 'application/pdf',
                size: 12,
                s3Key: 's3',
              },
            ],
            attachmentsForwarded: [
              {
                attachmentId: 'forwarded',
                filename: 'forward.txt',
                mimeType: 'text/plain',
                sizeBytes: 5,
              },
            ],
          },
        },
      },
    });
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    await lifecycle.prepareMutationQueue!();
    expect(await runtime.readLocalDraft('local')).toMatchObject({
      senderEmail: 'sender@example.com',
      attachments: [
        { type: 'remote', attachmentId: 'attachment', fileName: 'report.pdf' },
        { type: 'forwarded', attachmentId: 'forwarded' },
      ],
    });
    await lifecycle.onMutationAttemptResult!(
      { ...claimed(undefined), transactionId: 'legacy' },
      success,
      false
    );
    queue.length = 0;
    await runtime.localDraftQueueLifecycle(host).prepareMutationQueue!();
    expect(
      await runtime.localDraftStore.attempts(
        await runtime.localDraftStore.activate('owner')
      )
    ).toEqual([]);
  });
  it('rejects stale account and epoch readers without wiping existing content', async () => {
    await runtime.saveLocalDraft(input());
    auth.user = { authenticated: true, id: 'other-owner' };
    await expect(runtime.listLocalDrafts()).rejects.toThrow('no longer active');
    auth.user = { authenticated: true, id: 'owner' };
    expect(await runtime.listLocalDrafts()).toHaveLength(1);
    localStorage.setItem('email-working-copies:epoch', 'new-session');
    await expect(runtime.listLocalDrafts()).rejects.toThrow('no longer active');
  });
  it('rejects delayed old-editor work after logout even if authentication changes', async () => {
    const prior = await runtime.saveLocalDraft(input());
    const owner = await runtime.localDraftStore.activate('owner');
    auth.user = { authenticated: false, id: '' };
    await runtime.clearLocalDrafts();
    auth.user = { authenticated: true, id: 'other-owner' };
    await expect(
      runtime.saveLocalDraft(input('Late old editor'))
    ).rejects.toThrow('no longer active');
    await expect(
      runtime.localDraftStore.save(owner, {
        ...prior,
        expectedRevision: prior.revision,
      })
    ).rejects.toThrow();
  });
  it('reconciles again after a recovery failure without mutation metadata', async () => {
    const lifecycle = runtime.localDraftQueueLifecycle(host);
    await lifecycle.prepareMutationQueue!();
    const draft = await runtime.saveLocalDraft(input());
    const attempt = await runtime.beginDraftAttempt(draft, 'save');
    await runtime.markDraftAttemptQueued(attempt);
    await lifecycle.onMutationAttemptResult!(
      claimed(undefined),
      {
        error: {
          graphQLErrors: [{ extensions: { code: 'LOCAL_RECOVERY_FAILED' } }],
        },
      } as unknown as OperationResult,
      false
    );
    await lifecycle.prepareMutationQueue!();
    expect(await runtime.readLocalDraft('local')).toMatchObject({
      status: 'unconfirmed',
      content: { subject: 'Draft' },
    });
  });
});

it.each(['web', 'native'] as const)(
  'serializes restored copies of one file and adopts an existing upload receipt: %s',
  async (platform) => {
    native.active = platform === 'native';
    const locks = new Map<string, Promise<unknown>>();
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (name: string, run: () => Promise<void>) => {
          const previous = locks.get(name) ?? Promise.resolve();
          const next = previous.then(run);
          locks.set(
            name,
            next.catch(() => {})
          );
          return await next;
        },
      },
    });
    if (native.active) Reflect.deleteProperty(navigator, 'locks');
    try {
      const file = new File(['upload'], 'audit.txt');
      const local = await runtime.saveLocalDraft({
        ...input(),
        attachments: [{ type: 'local', file }],
      });
      const restored = (await runtime.restoreLocalAttachments(local))[0];
      if (restored.type !== 'local') throw new Error('Expected local file');
      const pending = Promise.withResolvers<void>(),
        started = Promise.withResolvers<void>();
      const upload = vi.fn(async () => {
        started.resolve();
        await pending.promise;
        await runtime.recordLocalAttachment(
          'local',
          file,
          'uploaded',
          true,
          local.generation
        );
      });
      const first = runtime.withLocalAttachmentUpload('local', file, upload);
      await started.promise;
      const adopt = vi.fn(async (receipt) => {
        expect(receipt.uploaded).toBe(true);
        expect(receipt.attachmentId).toBe('uploaded');
      });
      const second = runtime.withLocalAttachmentUpload(
        'local',
        restored.file,
        adopt
      );
      expect(adopt).not.toHaveBeenCalled();
      pending.resolve();
      await Promise.all([first, second]);
      expect(upload).toHaveBeenCalledOnce();
      expect(adopt).toHaveBeenCalledOnce();
    } finally {
      if (original) Object.defineProperty(navigator, 'locks', original);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  }
);
