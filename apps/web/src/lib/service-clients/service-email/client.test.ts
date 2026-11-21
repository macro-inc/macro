import { ok } from 'neverthrow';
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
    { headers: { 'X-Email-Link-Id': 'inbox-1' } }
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
