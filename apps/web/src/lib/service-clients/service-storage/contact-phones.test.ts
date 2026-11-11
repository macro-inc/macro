import { fetchWithToken } from '@core/util/fetchWithToken';
import { storageServiceClient } from '@service-storage/client';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

// Keep the real client; replace only transport and unrelated singletons.
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_DOCX_TO_PDF: false }));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: {},
  usePaywallState: () => ({ showPaywall: vi.fn() }),
}));
vi.mock('@core/util/mockClient', () => ({ registerClient: vi.fn() }));

it('reports refused phone numbers as BAD_REQUEST, like the other contact edits', async () => {
  vi.mocked(fetchWithToken).mockResolvedValue(ok({ phones: [] }));
  await storageServiceClient.setContactPhones({
    contactId: 'contact-1',
    phones: ['020 123'],
  });

  const [url, init] = vi.mocked(fetchWithToken).mock.calls[0];
  expect(url).toMatch(/\/crm\/contacts\/contact-1\/phones$/);
  const refused = await init?.errorResponseHandler?.(
    new Response(null, { status: 400 })
  );
  expect(refused).toMatchObject({ code: 'BAD_REQUEST' });
});
