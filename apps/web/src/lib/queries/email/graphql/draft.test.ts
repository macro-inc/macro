import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import type { SaveEmailDraftMutation } from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { map, pipe } from 'wonka';
import {
  executeGraphqlDeleteEmailDraft,
  executeGraphqlSaveEmailDraft,
  type GraphqlSaveEmailDraftArgs,
} from './draft';
import {
  draftThreadIsEmpty,
  removeDraftFromThread,
  updateDraftThread,
} from './optimistic-thread';

const args: GraphqlSaveEmailDraftArgs = {
  draftId: '01991e2a-3111-7000-8000-000000000001',
  threadDbId: 'thread',
  senderLinkId: 'inbox',
  senderEmail: 'sender@example.com',
  subject: 'Updated subject',
  optimisticBodyHtml: '<p>Updated body</p>',
};
function queuedClient() {
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
  return { client, operations };
}

describe('optimistic draft saves', () => {
  it('preserves attachments and scheduling through offline body edits and strips client state from the wire', async () => {
    const { client, operations } = queuedClient();
    await expect(executeGraphqlSaveEmailDraft(client, args)).resolves.toEqual({
      kind: 'queued',
      transactionId: 'queued',
    });
    const first = optimisticContextOf(operations[0])
      ?.optimisticResponse as SaveEmailDraftMutation;
    expect(first.saveEmailDraft.draft.calendarInvitations).toEqual([]);
    const existing = {
      ...first.saveEmailDraft.draft,
      calendarInvitations: [{ id: 'saved-invitation' }],
      createdAt: '2026-01-01T00:00:00Z',
      scheduledSendTime: '2027-01-01T12:00:00Z',
      hasAttachments: true,
      attachmentsDraft: [
        {
          __typename: 'GraphqlSoupEmailDraftAttachment' as const,
          id: 'attachment',
          draftId: String(args.draftId),
          fileName: 'notes.txt',
          contentType: 'text/plain',
          sha: 'sha',
          size: 5,
          s3Key: 'key',
        },
      ],
    };
    await executeGraphqlSaveEmailDraft(client, {
      ...args,
      existingDraft: existing,
    });
    const variables = operations[1].variables;
    const optimistic = optimisticContextOf(operations[1])?.optimisticResponse;
    expect(variables).toEqual({
      input: {
        draftId: args.draftId,
        threadDbId: 'thread',
        subject: 'Updated subject',
      },
    });
    expect(optimistic).toMatchObject({
      saveEmailDraft: {
        draft: {
          bodyHtmlSanitized: '<p>Updated body</p>',
          attachmentsDraft: existing.attachmentsDraft,
          hasAttachments: true,
          createdAt: existing.createdAt,
          scheduledSendTime: existing.scheduledSendTime,
          calendarInvitations: existing.calendarInvitations,
        },
      },
    });
  });
});

async function standalone() {
  const { client, operations } = queuedClient();
  await executeGraphqlSaveEmailDraft(client, {
    ...args,
    newThreadOwnerId: 'macro|owner@example.com',
    senderIsSignal: false,
  });
  const response = optimisticContextOf(operations[0])!
    .optimisticResponse as SaveEmailDraftMutation;
  return { ...response.saveEmailDraft, client, operations };
}

it('creates a complete standalone thread with the account classification and stable identity bindings', async () => {
  const { draft, thread, operations } = await standalone();
  expect(thread).toMatchObject({
    ownerId: 'macro|owner@example.com',
    isSignal: false,
    isRead: true,
    inboxVisible: true,
    mailAllPreview: { id: args.draftId },
    mailDraftPreview: { id: args.draftId },
    mailSentPreview: null,
    messages: [draft],
    properties: [],
    notifications: [],
    viewerPermission: { accessLevel: 'OWNER' },
    cacheProjection: null,
  });
  expect(thread.mailDraftState?.baseline.messageCount).toBe(0);
  expect(optimisticContextOf(operations[0])?.identityBindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        localKey: `GraphqlSoupEmailThread:${args.threadDbId}`,
        revalidationVariables: ['threadId'],
      }),
      expect.objectContaining({
        localKey: `GraphqlSoupEmailMessage:${args.draftId}`,
        referenceFields: expect.arrayContaining([
          'GraphqlMailPreviewMessage.id',
          'GraphqlMailDraftEntry.id',
        ]),
      }),
    ])
  );
});

it('editing an older draft keeps the later received preview and discarding restores the full baseline', async () => {
  const { draft, thread } = await standalone();
  const received = {
    ...thread.mailAllPreview!,
    id: 'received',
    isDraft: false,
    subject: 'Incoming',
  };
  const state = thread.mailDraftState!;
  const older = {
    ...draft,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-09-22T12:00:00Z',
  };
  state.drafts[0].facts.previewTs = older.createdAt;
  state.baseline = {
    ...state.baseline,
    messageCount: 24,
    isRead: false,
    isSignal: false,
    hasCalendarAttachment: true,
    preview: received,
    previewTs: '2026-02-01T00:00:00Z',
    latestNonSpamMessageTs: '2026-02-01T00:00:00Z',
    latestOutboundMessageTs: '2026-01-31T00:00:00Z',
  };
  const sent = { ...received, id: 'sent', subject: 'Sent' };
  const edited = updateDraftThread(
    { ...thread, mailSentPreview: sent },
    older,
    true
  );
  expect(edited.mailAllPreview).toEqual(received);
  expect(edited.mailDraftPreview?.id).toBe(draft.id);
  expect(edited.mailSentPreview).toEqual(sent);
  expect(edited.isRead).toBe(false);
  expect(edited.isSignal).toBe(true);
  const removed = removeDraftFromThread(edited, draft.id)!;
  expect(removed).toMatchObject({
    inboxVisible: false,
    isSignal: false,
    isRead: false,
    mailDraftPreview: null,
    mailAllPreview: received,
    mailSentPreview: sent,
    latestInboundMessageTs: null,
    sortTs: '2026-02-01T00:00:00Z',
    messages: [],
  });
  expect(removed.mailDraftState?.baseline.hasCalendarAttachment).toBe(true);
  expect(draftThreadIsEmpty(removed)).toBe(false);
});

it('discards a standalone draft with the original coalescing key and bindings for an in-flight save', async () => {
  const { client, operations, thread } = await standalone();
  await executeGraphqlDeleteEmailDraft(client, {
    draftId: String(args.draftId),
    threadDbId: args.threadDbId,
    existingThread: thread,
    mutationUuid: '01991e2a-3111-7000-8000-000000000099',
  });
  const context = optimisticContextOf(operations[1]);
  expect(context?.uuid).toBe('01991e2a-3111-7000-8000-000000000099');
  expect(context?.optimisticResponse).toMatchObject({
    deleteEmailDraft: {
      threadDeleted: true,
      thread: { mailAllPreview: null, mailDraftPreview: null, messages: [] },
    },
  });
  expect(
    context?.identityBindings?.every(
      (binding) => binding.responsePath.length === 0
    )
  ).toBe(true);
});
