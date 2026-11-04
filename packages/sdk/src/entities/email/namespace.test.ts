import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { Link } from './link';
import { EmailMessage } from './message';
import { EmailNamespace } from './namespace';

describe('email.sendConfirmed', () => {
  test('sends what the SendEmail tool takes, with the quoted approval', async () => {
    const requests: unknown[] = [];
    const client = {
      email: {
        listLinks: async () => ({
          data: {
            links: [{ id: 'work-link', email_address: 'ada@work.example' }],
          },
        }),
      },
      cognition: {
        sendConfirmedEmail: async ({ body }: { body: unknown }) => {
          requests.push(body);
          return {
            data: {
              sent: { message_id: 'sent-message', thread_id: 'sent-thread' },
            },
          };
        },
      },
    } as unknown as MacroClient;
    const workInbox = Link.byId(client, 'work-link');

    const sent = await new EmailNamespace(client).sendConfirmed({
      to: [{ email: 'grace@example.com', name: 'Grace' }],
      cc: [{ email: 'alan@example.com' }],
      subject: 'Re: Q3 numbers',
      body: 'Here are the **final** numbers.',
      from: workInbox,
      replyingTo: EmailMessage.byId(client, 'their-message'),
      attachments: [Document.byId(client, 'q3-report')],
      includeSignature: false,
      userConfirmation: 'yes, send it',
    });

    expect(requests).toEqual([
      {
        subject: 'Re: Q3 numbers',
        body: 'Here are the **final** numbers.',
        to: [{ email: 'grace@example.com', name: 'Grace' }],
        cc: [{ email: 'alan@example.com' }],
        bcc: undefined,
        from: 'ada@work.example',
        replyingToId: 'their-message',
        includeSignature: false,
        attachments: [{ documentId: 'q3-report' }],
        userConfirmation: 'yes, send it',
      },
    ]);
    expect(sent.message.id).toBe('sent-message');
    expect(sent.thread.id).toBe('sent-thread');
  });

  test('a send that reports no sent message fails instead of returning handles', async () => {
    const client = {
      cognition: {
        sendConfirmedEmail: async () => ({ data: 'userEdited' }),
      },
    } as unknown as MacroClient;

    await expect(
      new EmailNamespace(client).sendConfirmed({
        to: [{ email: 'grace@example.com' }],
        subject: 'Hello',
        body: 'Hi Grace.',
        userConfirmation: 'send it',
      }),
    ).rejects.toThrow('did not report a sent message');
  });
});
