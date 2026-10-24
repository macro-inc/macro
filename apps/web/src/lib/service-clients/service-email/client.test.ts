import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailClient } from './client';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: {
    'email-service': 'https://gateway.test/email',
    'calendar-service': 'https://gateway.test/calendar',
  },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: fetchMock }));

beforeEach(() => fetchMock.mockReset().mockResolvedValue(ok([])));

describe('email client URLs', () => {
  it('requests inbox settings operations from the email service once', async () => {
    await emailClient.settingsOperations('link-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.test/email/email/settings/operations',
      { headers: { 'X-Email-Link-Id': 'link-1' } }
    );
  });
});
