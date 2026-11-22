import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { AgentMailMessage } from './message';
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
    expect(await sent?.threadId()).toBe('t-1');
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

  test('a send or reply without an idempotency key is refused before any request', async () => {
    const requests: unknown[] = [];
    const record = async (request: unknown) => {
      requests.push(request);
      return { data: { id: 'sent-1', threadId: 't-1' } };
    };
    const client = {
      email: {
        sendAgentMailboxMessage: record,
        replyAgentMailboxMessage: record,
      },
    } as unknown as MacroClient;
    const mailbox = new AgentMailboxNamespace(client);
    // Code-mode programs are untyped: a missing key must fail, not mint one.
    const untyped = {
      to: ['a@example.com'],
      subject: 'Hi',
      textBody: 'x',
      userConfirmation: 'yes',
    } as unknown as Parameters<AgentMailboxNamespace['send']>[0];

    await expect(mailbox.send(untyped)).rejects.toThrow('idempotencyKey');
    await expect(
      AgentMailMessage.byId(client, 'm-1').reply({
        textBody: 'x',
        userConfirmation: 'yes',
      } as unknown as Parameters<AgentMailMessage['reply']>[0]),
    ).rejects.toThrow('idempotencyKey');
    expect(requests).toEqual([]);
  });

  test('a send passes its caller-chosen key, so a retry with it sends once', async () => {
    const requests: unknown[] = [];
    const client = {
      email: {
        sendAgentMailboxMessage: async (request: unknown) => {
          requests.push(request);
          return { data: { id: 'sent-1', threadId: 't-1' } };
        },
      },
    } as unknown as MacroClient;
    const mailbox = new AgentMailboxNamespace(client);
    const options = {
      to: ['a@example.com'],
      subject: 'Hi',
      textBody: 'x',
      userConfirmation: 'yes',
      idempotencyKey: 'k-1',
    };

    await mailbox.send(options);
    await mailbox.send(options);

    expect(
      requests.map(
        (request) =>
          (request as { body: { idempotencyKey: string } }).body.idempotencyKey,
      ),
    ).toEqual(['k-1', 'k-1']);
  });

  test('a send key is derived from a stable purpose, so a re-run of a program reuses it', () => {
    const client = { email: {} } as unknown as MacroClient;
    const purpose = 'reply to m-1 for task t-9';

    const first = new AgentMailboxNamespace(client).sendKey(purpose);
    const rerun = new AgentMailboxNamespace(client).sendKey(purpose);
    const other = new AgentMailboxNamespace(client).sendKey(
      'reply to m-2 for task t-9',
    );

    expect(first).toBe(rerun);
    expect(first).not.toBe(other);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(() => new AgentMailboxNamespace(client).sendKey(' ')).toThrow(
      'purpose',
    );
  });
});
