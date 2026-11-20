import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { AgentMailboxNamespace } from './namespace';

describe('agentMailbox', () => {
  test('a caller without a mailbox gets undefined', async () => {
    const client = {
      email: {
        getAgentMailbox: async () => ({
          error: { code: 'not_found', message: 'not found' },
          response: new Response(null, { status: 404 }),
        }),
      },
    } as unknown as MacroClient;

    expect(await new AgentMailboxNamespace(client).get()).toBeUndefined();
  });

  test('replies to a listed message with the quoted approval and a stable key', async () => {
    const requests: unknown[] = [];
    const client = {
      email: {
        listAgentMailboxMessages: async () => ({
          data: {
            messages: [
              {
                id: 'm-1',
                from: 'person@example.com',
                to: ['ada@example.net'],
                cc: [],
                subject: 'Hello',
                direction: 'inbound',
              },
            ],
            nextCursor: null,
          },
        }),
        replyAgentMailboxMessage: async (request: unknown) => {
          requests.push(request);
          return { data: { id: 'sent-1', threadId: 't-1' } };
        },
      },
    } as unknown as MacroClient;
    const mailbox = new AgentMailboxNamespace(client);

    const page = await mailbox.messages();
    const [message] = page.messages;
    const sent = await message?.reply({
      textBody: 'Thanks',
      userConfirmation: 'yes, reply',
      idempotencyKey: 'key-1',
    });

    expect(await message?.subject()).toBe('Hello');
    expect(page.nextCursor).toBeUndefined();
    expect(requests).toEqual([
      {
        path: { message_id: 'm-1' },
        body: {
          idempotencyKey: 'key-1',
          textBody: 'Thanks',
          confirmation: 'yes, reply',
        },
      },
    ]);
    expect(sent?.id).toBe('sent-1');
  });

  test('a listed message loads its body when the body is read', async () => {
    let reads = 0;
    const listed = {
      id: 'm-1',
      from: 'person@example.com',
      to: ['ada@example.net'],
      cc: [],
      subject: 'Hello',
      direction: 'inbound',
      textBody: null,
    };
    const client = {
      email: {
        listAgentMailboxMessages: async () => ({
          data: { messages: [listed], nextCursor: null },
        }),
        readAgentMailboxMessage: async () => {
          reads += 1;
          return { data: { ...listed, textBody: 'The full body' } };
        },
      },
    } as unknown as MacroClient;

    const [message] = (await new AgentMailboxNamespace(client).messages())
      .messages;

    expect(await message?.subject()).toBe('Hello');
    expect(reads).toBe(0);
    expect(await message?.textBody()).toBe('The full body');
    expect(reads).toBe(1);
  });
});
