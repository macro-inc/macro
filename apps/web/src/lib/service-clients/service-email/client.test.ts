import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const fetchWithToken = vi.hoisted(() => vi.fn());
vi.mock('@core/constant/servers', () => ({
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
