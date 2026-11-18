import { storageServiceClient } from '@service-storage/client';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSetCompanyHiddenMutation } from './companies';
import { crmKeys } from './keys';

const cache = vi.hoisted(() => ({
  commit: vi.fn(async () => {}),
  isCurrent: () => true,
}));
vi.mock('@service-storage/crm-visibility', () => ({
  prepareCrmVisibilityWrite: () => cache,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getCompany: vi.fn(), setCompanyHidden: vi.fn() },
}));
const company = {
  id: 'company-1',
  teamId: 'team-1',
  name: 'Example company',
  hidden: false,
  emailSync: true,
  domains: [],
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  contacts: [],
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.mocked(storageServiceClient.setCompanyHidden).mockResolvedValue(
    ok(undefined)
  );
});
afterEach(() => {
  cleanup();
  client.clear();
});
function mount() {
  let mutation!: ReturnType<typeof useSetCompanyHiddenMutation>;
  render(() => {
    mutation = useSetCompanyHiddenMutation({
      client,
      storage: storageServiceClient,
    });
    return null;
  });
  return mutation;
}
it('does not archive with an incomplete cached roster when the fresh roster fails', async () => {
  client.setQueryData(crmKeys.company(company.id).queryKey, company);
  vi.mocked(storageServiceClient.getCompany).mockResolvedValue(
    err([{ code: 'NETWORK_ERROR', message: 'Offline' }])
  );
  await expect(
    mount().mutateAsync({ companyId: company.id, hidden: true })
  ).rejects.toThrow();
  expect(storageServiceClient.setCompanyHidden).not.toHaveBeenCalled();
  expect(cache.commit).not.toHaveBeenCalled();
  expect(client.getQueryData(crmKeys.company(company.id).queryKey)).toEqual(
    company
  );
});
it('includes contacts absent from the cached company when applying a confirmed cascade', async () => {
  client.setQueryData(crmKeys.company(company.id).queryKey, company);
  const contact = {
    id: 'contact-1',
    companyId: company.id,
    name: 'Example person',
    email: 'person@example.com',
    hidden: false,
    createdAt: '2026-10-15',
    updatedAt: '2026-10-15',
    firstInteraction: '2026-10-15',
    lastInteraction: '2026-10-15',
  };
  vi.mocked(storageServiceClient.getCompany).mockResolvedValue(
    ok({ ...company, contacts: [contact] })
  );
  await mount().mutateAsync({ companyId: company.id, hidden: true });
  expect(cache.commit).toHaveBeenCalledWith({
    companyId: company.id,
    contactIds: [contact.id],
    hidden: true,
  });
});
