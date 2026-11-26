import { platformFetch } from '@core/util/platformFetch';
import { statusError } from '@core/util/safeFetch';
import { afterEach, expect, it, vi } from 'vitest';
import { storageServiceClient } from './client';
import { crmEmailPrivacyClient } from './crm-email-privacy';

vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));
const transport = vi.mocked(platformFetch);
afterEach(() => transport.mockReset());

it.each(['team', 'personal'] as const)(
  'preserves the server mailbox refusal through the real %s privacy transport',
  async (scope) => {
    const message =
      "Blocking this domain would hide all of a connected mailbox's email from the CRM.";
    transport.mockResolvedValueOnce(
      Response.json({ message }, { status: 400 })
    );
    const body = { action: 'add_domain' as const, scope, domain: 'gmail.com' };

    const result = await crmEmailPrivacyClient.update(body);

    expect(result._unsafeUnwrapErr()).toEqual([
      { code: 'HTTP_ERROR', message },
    ]);
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/crm/email-privacy'),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) })
    );
  }
);

it.each([
  () => storageServiceClient.blockCrmDomain({ domain: 'gmail.com' }),
  () =>
    storageServiceClient.setCompanyHidden({
      companyId: 'company',
      hidden: true,
    }),
  () =>
    storageServiceClient.setEmailSync({
      companyId: 'company',
      emailSync: false,
    }),
])('preserves the refusal on legacy CRM exclusion actions', async (update) => {
  const message =
    "Blocking this domain would hide all of a connected mailbox's email from the CRM.";
  transport.mockResolvedValueOnce(Response.json({ message }, { status: 400 }));

  expect((await update())._unsafeUnwrapErr()).toEqual([
    { code: 'HTTP_ERROR', message },
  ]);
});

it.each([
  [400, { message: 23 }],
  [400, { message: '' }],
  [403, { message: 'PRIVATE_SERVER_DETAIL' }],
  [500, { message: 'PRIVATE_SERVER_DETAIL' }],
])(
  'keeps the ordinary error for status %s without a valid refusal',
  async (status, body) => {
    transport.mockResolvedValueOnce(
      Response.json(body, { status: Number(status) })
    );

    const result = await crmEmailPrivacyClient.update({
      action: 'add_domain',
      scope: 'personal',
      domain: 'example.com',
    });

    expect(result._unsafeUnwrapErr()).toEqual([statusError(Number(status))]);
  }
);
