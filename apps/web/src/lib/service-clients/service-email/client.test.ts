import { err, ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const fetchWithToken = vi.hoisted(() => vi.fn());
vi.mock('@core/constant/servers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/servers')>()),
  SERVER_HOSTS: {
    'email-service': 'https://gateway.example/email',
    'calendar-service': 'https://gateway.example/calendar',
  },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken }));

import { emailClient } from './client';

it('scopes settings polling to the inbox and adds the email host once', async () => {
  fetchWithToken.mockResolvedValue(ok([]));
  await emailClient.settingsOperations('inbox-1');
  expect(fetchWithToken).toHaveBeenCalledWith(
    'https://gateway.example/email/email/settings/operations',
    {
      headers: { 'X-Email-Link-Id': 'inbox-1' },
      trace: { parentSpan: expect.any(Object) },
      errorResponseFilter: expect.any(Function),
    }
  );
});

async function initFailure(status: number, body: string) {
  fetchWithToken.mockResolvedValue(ok({ link_id: 'link-1' }));
  await emailClient.init({ linkId: 'attempt-1' });
  const options = fetchWithToken.mock.lastCall?.[1] as {
    errorResponseHandler: (response: Response) => Promise<{
      code: string;
      message: string;
    }>;
  };
  return options.errorResponseHandler(new Response(body, { status }));
}

const share = {
  email_address: 'team@example.com',
  existing_owner_email: 'owner@example.com',
  existing_link_id: 'link-2',
};

it.each([
  ['a coded share conflict', { code: 'SHARED_INBOX_CONFLICT', ...share }],
  ['a share conflict from a server without codes', share],
])('offers to share the inbox for %s', async (_, body) => {
  const failure = await initFailure(409, JSON.stringify(body));
  expect(failure.code).toBe('SHARED_INBOX_CONFLICT');
  expect(JSON.parse(failure.message)).toEqual({
    emailAddress: 'team@example.com',
    existingOwnerEmail: 'owner@example.com',
  });
});

it.each(['INBOX_IDENTITY_CONFLICT', 'INBOX_CHANGED'])(
  'keeps a %s conflict its own',
  async (code) => {
    const failure = await initFailure(
      409,
      JSON.stringify({ code, message: 'server text' })
    );
    expect(failure).toEqual({ code, message: 'server text' });
  }
);

it.each([
  ['a plain-text 409', 'the mailbox changed while connecting; retry'],
  ['a 409 with an unknown code', JSON.stringify({ code: 'SOMETHING_NEW' })],
])('never reads %s as a share conflict', async (_, body) => {
  const failure = await initFailure(409, body);
  expect(failure.code).toBe('HTTP_ERROR');
});

it.each([
  ['message', () => emailClient.getMessage({ message_id: 'message-1' })],
  ['source', () => emailClient.getMessageEml({ message_id: 'message-1' })],
])(
  'describes unsupported content on the %s path without provider text',
  async (_, read) => {
    fetchWithToken.mockImplementationOnce(async (_input, options) =>
      err([
        await options.errorResponseFilter(
          new Response(
            JSON.stringify({
              code: 'message_too_large',
              message: 'untrusted provider detail',
            }),
            { status: 413 }
          )
        ),
      ])
    );
    const result = await read();
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error[0].message).toBe(
        'This message is too large to open in Macro (over 25 MB).'
      );
  }
);

it('retries a busy label action once after the capped retry delay', async () => {
  vi.useFakeTimers();
  fetchWithToken.mockClear();
  const refused = async (
    _input: string,
    options: {
      errorResponseFilter: (
        response: Response
      ) => Promise<{ code: string; message: string }>;
    }
  ) =>
    err([
      await options.errorResponseFilter(
        new Response('', { status: 429, headers: { 'Retry-After': '99' } })
      ),
    ]);
  fetchWithToken
    .mockImplementationOnce(refused)
    .mockImplementationOnce(refused);
  try {
    const result = emailClient.updateMessageLabelBatch({
      message_ids: ['message-1'],
      label_id: 'UNREAD',
      value: false,
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchWithToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const settled = await result;
    expect(fetchWithToken).toHaveBeenCalledTimes(2);
    expect(settled.isErr()).toBe(true);
    if (settled.isErr())
      expect(settled.error[0].message).toBe('Mailbox is busy, try again.');
  } finally {
    vi.useRealTimers();
  }
});

it('never retries a send when the server responds busy', async () => {
  fetchWithToken.mockClear();
  fetchWithToken.mockImplementationOnce(async (_input, options) =>
    err([
      await options.errorResponseFilter(
        new Response('', { status: 429, headers: { 'Retry-After': '0' } })
      ),
    ])
  );
  const result = await emailClient.sendMessage({
    message: { subject: 'Synthetic send' },
  });
  expect(result.isErr()).toBe(true);
  expect(fetchWithToken).toHaveBeenCalledTimes(1);
});
