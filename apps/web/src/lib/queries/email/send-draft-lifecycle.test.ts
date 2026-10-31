import 'fake-indexeddb/auto';
import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import type { CacheHost } from '@graphql-cache/host/types';
import type { ClaimedMutation } from '@graphql-cache/protocol';
import { SaveEmailDraftDocument } from '@service-storage/graphql/generated/graphql';
import { createRequest, makeOperation, type OperationResult } from '@urql/core';
import { print } from 'graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GraphqlSaveEmailDraftArgs } from './graphql/draft';
import type { LocalDraftInput } from './local-drafts';

const auth = vi.hoisted(() => ({ user: { authenticated: true, id: 'owner' } }));
vi.mock('../client', () => ({
  queryClient: { getQueryData: () => auth.user },
}));
vi.mock('@core/mobile/nativeStagedUpload', () => ({
  getNativeStagedUpload: () => undefined,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

let drafts: typeof import('./local-drafts');
let lifecycle: typeof import('./send-draft-lifecycle');

const args: GraphqlSaveEmailDraftArgs = {
  draftId: 'local-draft',
  threadDbId: 'local-thread',
  senderLinkId: 'inbox',
  senderEmail: 'sender@email-send.test',
  subject: 'Original subject',
  to: [{ email: 'recipient@email-send.test' }],
  bodyText: 'Original body',
  bodyHtml: 'PHA+T3JpZ2luYWwgYm9keTwvcD4=',
  optimisticBodyHtml: '<p>Original body</p>',
};

function input(attachments: DraftFormAttachment[] = []): LocalDraftInput {
  return {
    clientHandles: { draftId: String(args.draftId), threadId: args.threadDbId },
    inboxId: args.senderLinkId,
    senderEmail: args.senderEmail,
    draft: {
      subject: args.subject,
      to: args.to,
      body_text: args.bodyText,
      body_html: args.bodyHtml,
    },
    attachments,
  };
}

function uploadedAttachments(): DraftFormAttachment[] {
  return [
    {
      type: 'local',
      file: new File(['hello'], 'uploaded.txt', { type: 'text/plain' }),
      attachmentId: 'uploaded',
      uploaded: true,
    },
    {
      type: 'forwarded',
      attachmentId: 'forwarded',
      fileName: 'forwarded.pdf',
      mimeType: 'application/pdf',
      fileSize: 25,
    },
  ];
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  drafts = await import('./local-drafts');
  lifecycle = await import('./send-draft-lifecycle');
  await drafts.localDraftStore.clear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await drafts.localDraftStore.close();
});

it('restores the frozen alias into a replacement working copy after restart', async () => {
  const alias = 'alias@email-send.test';
  const frozen = JSON.parse(JSON.stringify({ ...args, senderEmail: alias }));
  await drafts.localDraftStore.close();
  vi.resetModules();
  drafts = await import('./local-drafts');
  lifecycle = await import('./send-draft-lifecycle');

  const restoredArgs = await lifecycle.restoreSendWorkingCopy(
    frozen,
    undefined
  );
  const restored = (await drafts.readLocalDraft(String(args.draftId)))!;

  expect(restored.content.sender_email).toBe(alias);
  expect(restored.senderEmail).toBe(alias);
  expect(drafts.localDraftMessage(restored).from?.email).toBe(alias);
  expect(restoredArgs.senderEmail).toBe(alias);
});

it('preserves the sender of an older working copy without content.sender_email', async () => {
  const alias = 'legacy-alias@email-send.test';
  const legacy = await drafts.saveLocalDraft({
    ...input(),
    senderEmail: alias,
  });
  expect(legacy.content.sender_email).toBeUndefined();

  const restoredArgs = await lifecycle.restoreSendWorkingCopy(args, undefined);

  expect(restoredArgs.senderEmail).toBe(alias);
  expect(
    drafts.localDraftMessage((await drafts.readLocalDraft(legacy.key))!).from
      ?.email
  ).toBe(alias);
});

it('preserves uploaded and forwarded descriptors through retirement, restart, and offline restore', async () => {
  const original = await drafts.saveLocalDraft(input(uploadedAttachments()));
  const captured = await lifecycle.captureSendWorkingCopy(
    original.key,
    ['uploaded'],
    ['forwarded'],
    original
  );
  expect(captured).toMatchObject({
    key: original.key,
    generation: original.generation,
    revision: original.revision,
    attachments: [
      { type: 'local', attachmentId: 'uploaded', uploaded: true },
      { type: 'forwarded', attachmentId: 'forwarded' },
    ],
  });
  // The durable send journal carries serializable descriptors, not file blobs.
  const recovered = JSON.parse(JSON.stringify(captured));
  expect(recovered).toEqual(captured);
  await lifecycle.retireSendWorkingCopy(captured);
  expect(await drafts.readLocalDraft(original.key)).toBeUndefined();
  await drafts.localDraftStore.close();
  vi.resetModules();
  drafts = await import('./local-drafts');
  lifecycle = await import('./send-draft-lifecycle');
  const fetch = vi.fn(() => Promise.reject(new Error('Offline')));
  vi.stubGlobal('fetch', fetch);

  const restoredArgs = await lifecycle.restoreSendWorkingCopy(args, recovered);
  const restored = (await drafts.readLocalDraft(original.key))!;
  expect(restored.generation).not.toBe(original.generation);
  expect(restored.attachments).toEqual([
    {
      type: 'remote',
      attachmentId: 'uploaded',
      fileName: 'uploaded.txt',
      contentType: 'text/plain',
      fileSize: 5,
      url: '',
    },
    {
      type: 'forwarded',
      attachmentId: 'forwarded',
      fileName: 'forwarded.pdf',
      mimeType: 'application/pdf',
      fileSize: 25,
    },
  ]);
  expect(await drafts.restoreLocalAttachments(restored)).toEqual(
    restored.attachments
  );
  expect(restoredArgs).toMatchObject({
    draftId: original.draftId,
    localRevision: restored.revision,
    subject: args.subject,
    to: args.to,
    bodyHtml: args.bodyHtml,
    bodyText: args.bodyText,
    optimisticBodyHtml: '<p>Original body</p>',
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('fences old save results, stale editor callbacks, and delayed retirement after restore', async () => {
  const original = await drafts.saveLocalDraft(input());
  const attempt = await drafts.beginDraftAttempt(original, 'save');
  const captured = await lifecycle.captureSendWorkingCopy(
    original.key,
    [],
    [],
    original
  );
  await lifecycle.retireSendWorkingCopy(captured);
  await lifecycle.restoreSendWorkingCopy(args, captured);
  const restored = (await drafts.readLocalDraft(original.key))!;
  expect(restored.generation).not.toBe(original.generation);
  const host = {
    inspectMutations: async () => [],
    currentStorageGeneration: async () => 'storage',
  } as unknown as CacheHost;
  const variables = {
    input: {
      draftId: original.draftId,
      threadDbId: original.threadId,
      subject: original.content.subject,
    },
  };
  const claimed: ClaimedMutation = {
    transactionId: 'old-save',
    uuid: '00000000-0000-4000-8000-000000000001',
    clientMetadata: attempt,
    operationName: 'SaveEmailDraft',
    superseded: false,
    requiresConfirmation: false,
    leaseGeneration: '1',
    query: print(SaveEmailDraftDocument),
    variables,
    identity: auth.user.id,
    attemptCount: 1,
    serverFailureCount: 0,
  };
  const response: OperationResult = {
    operation: makeOperation(
      'mutation',
      createRequest(SaveEmailDraftDocument, variables),
      { url: 'http://email-send.test/graphql', requestPolicy: 'network-only' }
    ),
    data: {
      saveEmailDraft: {
        draftId: 'stale-server-id',
        thread: { id: 'stale-thread' },
      },
    },
    stale: false,
    hasNext: false,
  };
  await drafts.localDraftQueueLifecycle(host).onMutationAttemptResult!(
    claimed,
    response,
    false
  );
  await lifecycle.retireSendWorkingCopy(captured);
  await expect(
    drafts.saveLocalDraft({
      ...input(),
      draft: { subject: 'Stale editor text' },
      expectedGeneration: original.generation,
      expectedRevision: original.revision,
    })
  ).rejects.toThrow();
  expect(await drafts.readLocalDraft(original.key)).toEqual(restored);
});

it('preserves a newer revision when send cleanup arrives after another local edit', async () => {
  const original = await drafts.saveLocalDraft(input());
  const captured = await lifecycle.captureSendWorkingCopy(
    original.key,
    [],
    [],
    original
  );
  const newer = await drafts.saveLocalDraft({
    ...input(),
    draft: { subject: 'Newer unsent edit', body_text: 'Keep this content' },
  });
  await lifecycle.retireSendWorkingCopy(captured);
  const restored = await lifecycle.restoreSendWorkingCopy(args, captured);
  const resumed = (await drafts.readLocalDraft(original.key))!;
  expect(resumed.generation).not.toBe(original.generation);
  expect(resumed).toMatchObject({
    revision: newer.revision,
    content: newer.content,
  });
  expect(restored).toMatchObject({
    subject: 'Newer unsent edit',
    bodyText: 'Keep this content',
    localRevision: newer.revision,
  });
  await lifecycle.retireSendWorkingCopy(captured);
  expect(await drafts.readLocalDraft(original.key)).toEqual(resumed);
});

it('reuses newer edits from another restored generation instead of the old send snapshot', async () => {
  const original = await drafts.saveLocalDraft(input());
  const captured = await lifecycle.captureSendWorkingCopy(
    original.key,
    [],
    [],
    original
  );
  await lifecycle.retireSendWorkingCopy(captured);
  await lifecycle.restoreSendWorkingCopy(args, captured);
  const newer = await drafts.saveLocalDraft({
    ...input(),
    inboxId: 'other-inbox',
    senderEmail: 'other-sender@email-send.test',
    draft: {
      subject: 'Edited after restore',
      to: [{ email: 'different@email-send.test' }],
      body_text: 'New body',
      body_html: 'PHA+TmV3IGJvZHk8L3A+',
    },
  });

  const restoredAgain = await lifecycle.restoreSendWorkingCopy(args, captured);
  expect(restoredAgain).toMatchObject({
    localRevision: newer.revision,
    senderLinkId: 'other-inbox',
    linkId: 'other-inbox',
    senderEmail: 'other-sender@email-send.test',
    subject: 'Edited after restore',
    to: [{ email: 'different@email-send.test' }],
    bodyText: 'New body',
    optimisticBodyHtml: '<p>New body</p>',
  });
  expect(await drafts.readLocalDraft(original.key)).toMatchObject({
    generation: newer.generation,
    revision: newer.revision,
    content: newer.content,
  });
});

it('rejects a send with an allocated attachment id whose upload is incomplete', async () => {
  const local = await drafts.saveLocalDraft(
    input([
      {
        type: 'local',
        file: new File(['pending'], 'pending.txt'),
        attachmentId: 'allocated',
        uploaded: false,
      },
    ])
  );
  await expect(
    lifecycle.captureSendWorkingCopy(local.key, ['allocated'], [], local)
  ).rejects.toThrow('Finish uploading');
  expect(await drafts.readLocalDraft(local.key)).toEqual(local);
});

it.each([
  [[], ['forwarded']],
  [['uploaded'], []],
  [['uploaded', 'unexpected'], ['forwarded']],
  [['forwarded'], ['uploaded']],
])(
  'rejects changed send attachment membership (%j, %j)',
  async (files, forwards) => {
    const local = await drafts.saveLocalDraft(input(uploadedAttachments()));
    await expect(
      lifecycle.captureSendWorkingCopy(local.key, files, forwards, local)
    ).rejects.toThrow('Attachments changed');
    expect(await drafts.readLocalDraft(local.key)).toEqual(local);
  }
);

it('rejects newer edits made after the sending editor persisted its snapshot', async () => {
  const submitted = await drafts.saveLocalDraft(input());
  const newer = await drafts.saveLocalDraft({
    ...input(),
    draft: {
      subject: 'Other tab subject',
      body_text: 'Keep these newer edits',
    },
    expectedGeneration: submitted.generation,
    expectedRevision: submitted.revision,
  });

  await expect(
    lifecycle.captureSendWorkingCopy(submitted.key, [], [], submitted)
  ).rejects.toThrow('changed while preparing the send');
  expect(await drafts.readLocalDraft(submitted.key)).toEqual(newer);
});

it('rejects a replaced draft lifetime even when its revision matches the submitted version', async () => {
  const submitted = await drafts.saveLocalDraft(input());
  await drafts.forgetLocalDraft(submitted.key, submitted);
  await drafts.reviveLocalDraft(submitted.key);
  const restored = await drafts.saveLocalDraft(input());
  expect(restored.revision).toBe(submitted.revision);
  expect(restored.generation).not.toBe(submitted.generation);

  await expect(
    lifecycle.captureSendWorkingCopy(submitted.key, [], [], submitted)
  ).rejects.toThrow('changed while preparing the send');
  expect(await drafts.readLocalDraft(submitted.key)).toEqual(restored);
});

it('rejects a working copy removed after the sending editor persisted it', async () => {
  const submitted = await drafts.saveLocalDraft(input());
  await drafts.forgetLocalDraft(submitted.key, submitted);

  await expect(
    lifecycle.captureSendWorkingCopy(submitted.key, [], [], submitted)
  ).rejects.toThrow('changed while preparing the send');
});

it('requires the sending editor version when a local working copy exists', async () => {
  const local = await drafts.saveLocalDraft(input());
  await expect(
    lifecycle.captureSendWorkingCopy(local.key, [], [])
  ).rejects.toThrow('changed while preparing the send');
  expect(await drafts.readLocalDraft(local.key)).toEqual(local);
});
