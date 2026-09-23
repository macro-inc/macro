import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import type { SaveEmailDraftMutation } from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { map, pipe } from 'wonka';
import {
  executeGraphqlSaveEmailDraft,
  type GraphqlSaveEmailDraftArgs,
} from './draft';

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
    const existing = {
      ...first.saveEmailDraft.draft,
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
        },
      },
    });
  });
});
