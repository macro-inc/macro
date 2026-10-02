import 'fake-indexeddb/auto';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  ClaimedMutation,
  MutationInspection,
} from '@graphql-cache/protocol';
import type { OperationResult } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: { authenticated: true, id: 'owner' } }));
vi.mock('../client', () => ({
  queryClient: { getQueryData: () => auth.user },
}));
vi.mock('@core/mobile/nativeStagedUpload', () => ({
  getNativeStagedUpload: () => undefined,
}));
let runtime: typeof import('./local-drafts');
const input = (subject = 'Draft') => ({
  draft: { subject },
  clientHandles: { draftId: 'local', threadId: 'thread' },
  attachments: [],
});
const queue: MutationInspection[] = [];
const host = {
  inspectMutations: async () => queue,
  currentStorageGeneration: async () => 'storage',
} as unknown as CacheHost;
const claimed = (metadata: unknown) =>
  ({
    transactionId: 'tx',
    clientMetadata: metadata,
    operationName: 'SaveEmailDraft',
    superseded: false,
  }) as ClaimedMutation;
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
  auth.user = { authenticated: true, id: 'owner' };
  runtime = await import('./local-drafts');
  await runtime.localDraftStore.clear();
});
afterEach(async () => {
  await runtime.localDraftStore.close();
});

describe('draft queue recovery', () => {
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
    await expect(runtime.localDraftStore.save(owner, prior)).rejects.toThrow();
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
