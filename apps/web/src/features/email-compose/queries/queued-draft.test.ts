import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import { executeGraphqlSaveEmailDraft } from '@queries/email/graphql/draft';
import type { SaveEmailDraftMutation } from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation } from '@urql/core';
import { expect, it } from 'vitest';
import { map, pipe } from 'wonka';
import { queuedDraftSaveArgs } from './queued-draft';

const input = {
  draft: { subject: 'Offline draft', body_html: btoa('<p>Hello</p>') },
  handles: {
    draftId: '01991e2a-3111-7000-8000-000000000001',
    threadId: 'local-thread',
  },
  senderLinkId: 'selected-inbox',
  senderEmail: 'sender@example.com',
};

it.each(['macro|self@example.com', 'macro|delegated@example.com'])(
  'creates a queued Mail thread from inbox owner %s without viewer metadata',
  async (owner) => {
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
    const args = queuedDraftSaveArgs({
      ...input,
      senderAccount: { macro_id: owner, draft_is_signal: false },
    });
    expect(await executeGraphqlSaveEmailDraft(client, args)).toMatchObject({
      kind: 'queued',
    });
    const optimistic = optimisticContextOf(operations[0]);
    const response = optimistic?.optimisticResponse as SaveEmailDraftMutation;
    expect(response.saveEmailDraft.thread).toMatchObject({
      id: input.handles.threadId,
      ownerId: owner,
      linkId: input.senderLinkId,
      isDraft: true,
      isSignal: false,
      mailDraftPreview: { id: input.handles.draftId, subject: 'Offline draft' },
      messages: [
        { id: input.handles.draftId, bodyHtmlSanitized: '<p>Hello</p>' },
      ],
    });
    expect(optimistic?.identityBindings).toContainEqual(
      expect.objectContaining({
        localKey: `GraphqlSoupEmailThread:${input.handles.threadId}`,
        responsePath: ['saveEmailDraft', 'thread'],
      })
    );
    expect(operations[0].variables?.input).not.toHaveProperty(
      'newThreadOwnerId'
    );
  }
);

it.each([undefined, { macro_id: '' }])(
  'does not accept an invisible new draft when account metadata is %j',
  (senderAccount) => {
    expect(() => queuedDraftSaveArgs({ ...input, senderAccount })).toThrow(
      'sending account is available'
    );
    expect(
      queuedDraftSaveArgs({
        ...input,
        senderAccount: { macro_id: 'macro|owner' },
      }).newThreadOwnerId
    ).toBe('macro|owner');
  }
);

it.each([
  { thread_db_id: 'existing-thread' },
  { replying_to_id: 'reply-target' },
])(
  'does not require a new owner for an existing conversation %j',
  (identity) => {
    expect(
      queuedDraftSaveArgs({ ...input, draft: { ...input.draft, ...identity } })
        .newThreadOwnerId
    ).toBeUndefined();
  }
);
