import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { EmailDraft } from './draft';
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

describe('EmailMessage.forwardConfirmed', () => {
  test('quotes the message, attaches its files and sends from its inbox', async () => {
    const requests: unknown[] = [];
    const client = {
      email: {
        getMessage: async () => ({
          data: {
            db_id: 'their-message',
            link_id: 'work-link',
            thread_db_id: 'their-thread',
            subject: 'Q3 numbers',
            from: { email: 'grace@example.com', name: 'Grace' },
            to: [{ email: 'ada@work.example' }],
            cc: [],
            bcc: [],
            labels: [],
            internal_date_ts: '2026-11-02T09:30:00Z',
            body_parsed: 'Numbers attached.\n\n*Final* figures, v1.2',
          },
        }),
        getThread: async () => ({
          data: {
            thread: {
              messages: [
                { db_id: 'other-message', attachments: [{ db_id: 'logo' }] },
                { db_id: 'their-message', attachments: [{ db_id: 'q3-xlsx' }] },
              ],
            },
          },
        }),
        getAttachmentDocumentId: async ({
          path,
        }: {
          path: { id: string };
        }) => ({ data: { document_id: `document-of-${path.id}` } }),
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
              sent: { message_id: 'forward', thread_id: 'forward-thread' },
            },
          };
        },
      },
    } as unknown as MacroClient;

    const sent = await EmailMessage.byId(
      client,
      'their-message',
    ).forwardConfirmed({
      to: [{ email: 'alan@example.com' }],
      body: 'FYI, see below.',
      userConfirmation: 'yes, forward it to Alan',
    });

    expect(requests).toEqual([
      {
        subject: 'Fwd: Q3 numbers',
        body: [
          'FYI, see below.',
          [
            '\\-\\-\\-\\-\\-\\-\\-\\-\\-\\- Forwarded message \\-\\-\\-\\-\\-\\-\\-\\-\\-\\-',
            'From: Grace \\<grace@example\\.com\\>',
            'Date: Mon, 02 Nov 2026 09:30:00 GMT',
            'Subject: Q3 numbers',
            'To: ada@work\\.example \\<ada@work\\.example\\>',
          ].join('\n\n'),
          '> Numbers attached\\.\n>\n> \\*Final\\* figures, v1\\.2',
        ].join('\n\n'),
        to: [{ email: 'alan@example.com' }],
        cc: undefined,
        bcc: undefined,
        from: 'ada@work.example',
        includeSignature: undefined,
        attachments: [{ documentId: 'document-of-q3-xlsx' }],
        userConfirmation: 'yes, forward it to Alan',
      },
    ]);
    expect(sent.message.id).toBe('forward');
  });
});

describe('EmailDraft.send', () => {
  test('hands the saved draft to the scheduled sender with the quoted approval', async () => {
    const requests: Array<{
      headers: Record<string, string>;
      body: { send_time: string; user_confirmation?: string };
    }> = [];
    const client = {
      email: {
        getMessage: async () => ({
          data: { db_id: 'draft', link_id: 'work-link', draft_generation: 3 },
        }),
        upsertScheduledMessage: async (request: (typeof requests)[number]) => {
          requests.push(request);
          return { data: {} };
        },
      },
    } as unknown as MacroClient;
    const before = Date.now();

    await EmailDraft.byId(client, 'draft').send({
      userConfirmation: 'send it',
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.headers).toEqual({ 'X-Email-Link-Id': 'work-link' });
    expect(request.body.user_confirmation).toBe('send it');
    expect(Date.parse(request.body.send_time)).toBeGreaterThan(before);
  });
});
