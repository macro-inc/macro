import { createClient, type Operation } from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';

const getClient = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getClient,
}));

import {
  composeDraftInput,
  saveEmailComposeDraft,
  sendEmailComposeMessage,
} from './compose';

const input = {
  subject: 'Resident',
  sender_email: 'resident@example.com',
  body_html: 'aGk',
  to: [{ email: 'customer@example.com' }],
};

describe('GraphQL compose transport', () => {
  it('carries sender and stable client handles in both save and online send', async () => {
    const operations: Operation[] = [];
    const client = createClient({
      url: 'https://unused/graphql',
      exchanges: [
        () => (ops) =>
          pipe(
            ops,
            map((operation) => {
              operations.push(operation);
              return {
                operation,
                stale: false,
                hasNext: false,
                data: {
                  saveEmailDraft: {
                    draftId: 'server-message',
                    draft: { threadId: 'server-thread', linkId: 'delegated' },
                  },
                  sendEmailMessage: {
                    messageId: 'server-message',
                    threadId: 'server-thread',
                    linkId: 'delegated',
                    sendTime: null,
                  },
                },
              };
            })
          ),
      ],
    });
    getClient.mockReturnValue(client);
    const handles = { draftId: 'client-message', threadId: 'client-thread' };
    expect(
      await saveEmailComposeDraft({
        draft: input,
        inboxId: 'delegated',
        clientHandles: handles,
      })
    ).toEqual({
      draftId: 'server-message',
      threadId: 'server-thread',
      inboxId: 'delegated',
    });
    expect(
      await sendEmailComposeMessage({
        message: { ...input, include_signature: false },
        inboxId: 'delegated',
        clientHandles: handles,
      })
    ).toEqual({
      draftId: 'server-message',
      threadId: 'server-thread',
      inboxId: 'delegated',
    });
    expect(operations[0].variables?.input).toMatchObject({
      draftId: 'client-message',
      threadDbId: 'client-thread',
      senderEmail: 'resident@example.com',
      linkId: 'delegated',
    });
    expect(operations[1].variables?.input).toMatchObject({
      draft: operations[0].variables?.input,
      includeSignature: false,
    });
    expect(operations[1].context.optimistic).toBeUndefined();
  });
  it('refuses to send without a stable draft identity', () => {
    expect(() => composeDraftInput(input)).toThrow(
      'Save the draft before sending'
    );
  });
});
