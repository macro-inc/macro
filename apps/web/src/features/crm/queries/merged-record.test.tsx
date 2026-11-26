import { storageServiceClient } from '@service-storage/client';
import type { CrmContactDetailResponse } from '@service-storage/generated/schemas/crmContactDetailResponse';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompanyQuery } from './companies';
import { useContactQuery } from './contacts';
import { crmKeys } from './keys';

const forget = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@service-storage/crm-record-merge', () => ({
  forgetMergedCrmRecords: forget,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getCompany: vi.fn(), getContact: vi.fn() },
}));

const MERGED = '019a0000-0000-7000-8000-0000000000a1';
const KEPT = '019a0000-0000-7000-8000-0000000000a2';
const kept = {
  id: KEPT,
  teamId: 'team-1',
  name: 'Kept company',
  hidden: false,
  emailSync: true,
  domains: [],
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  contacts: [],
};
const keptContact: CrmContactDetailResponse = {
  id: KEPT,
  companyId: null,
  email: 'kept@contacts.example',
  emails: ['kept@contacts.example', 'merged@contacts.example'],
  personalEmail: false,
  companyDomain: false,
  companyDomainEmails: [],
  name: 'Kept contact',
  hidden: false,
  firstInteraction: '2026-10-15',
  lastInteraction: '2026-10-15',
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
};

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('a company read', () => {
  function read(companyId: string) {
    let shown!: ReturnType<typeof useCompanyQuery>;
    render(() => {
      shown = useCompanyQuery(
        { client, storage: storageServiceClient },
        () => companyId
      );
      return null;
    });
    return shown;
  }

  it("caches a merged company's read under the company that stays and forgets its old record", async () => {
    vi.mocked(storageServiceClient.getCompany).mockResolvedValue(ok(kept));

    const shown = read(MERGED.toUpperCase());

    await vi.waitFor(() => expect(shown.company()?.id).toBe(KEPT));
    expect(client.getQueryData(crmKeys.company(KEPT).queryKey)).toEqual(kept);
    expect(forget).toHaveBeenCalledExactlyOnceWith({
      companies: [MERGED],
      contacts: [],
    });
  });

  it('leaves a fresher read of the company that stays in place', async () => {
    const fresher = { ...kept, name: 'Renamed' };
    client.setQueryData(crmKeys.company(KEPT).queryKey, fresher, {
      updatedAt: 1,
    });
    vi.mocked(storageServiceClient.getCompany).mockResolvedValue(ok(kept));

    const shown = read(MERGED);

    await vi.waitFor(() => expect(shown.company()?.id).toBe(KEPT));
    expect(client.getQueryData(crmKeys.company(KEPT).queryKey)).toBe(fresher);
    expect(
      client.getQueryState(crmKeys.company(KEPT).queryKey)?.dataUpdatedAt
    ).toBe(1);
  });

  it('answers a company read under its own id without forgetting anything', async () => {
    vi.mocked(storageServiceClient.getCompany).mockResolvedValue(ok(kept));

    const shown = read(KEPT.toUpperCase());

    await vi.waitFor(() => expect(shown.company()?.id).toBe(KEPT));
    expect(forget).not.toHaveBeenCalled();
  });
});

describe('a contact read', () => {
  function read(contactId: string) {
    let shown!: ReturnType<typeof useContactQuery>;
    render(() => {
      shown = useContactQuery(
        { client, storage: storageServiceClient },
        () => contactId
      );
      return null;
    });
    return shown;
  }

  it("caches a merged contact's read under the contact that stays and forgets its old record", async () => {
    vi.mocked(storageServiceClient.getContact).mockResolvedValue(
      ok(keptContact)
    );

    const shown = read(MERGED.toUpperCase());

    await vi.waitFor(() => expect(shown.data?.id).toBe(KEPT));
    expect(client.getQueryData(crmKeys.contact(KEPT).queryKey)).toEqual(
      keptContact
    );
    expect(forget).toHaveBeenCalledExactlyOnceWith({
      companies: [],
      contacts: [MERGED],
    });
  });

  it('leaves a fresher read of the contact that stays in place', async () => {
    const fresher = { ...keptContact, name: 'Renamed' };
    client.setQueryData(crmKeys.contact(KEPT).queryKey, fresher, {
      updatedAt: 1,
    });
    vi.mocked(storageServiceClient.getContact).mockResolvedValue(
      ok(keptContact)
    );

    const shown = read(MERGED);

    await vi.waitFor(() => expect(shown.data?.id).toBe(KEPT));
    expect(client.getQueryData(crmKeys.contact(KEPT).queryKey)).toBe(fresher);
    expect(
      client.getQueryState(crmKeys.contact(KEPT).queryKey)?.dataUpdatedAt
    ).toBe(1);
  });

  it('answers a contact read under its own id without forgetting anything', async () => {
    vi.mocked(storageServiceClient.getContact).mockResolvedValue(
      ok(keptContact)
    );

    const shown = read(KEPT.toUpperCase());

    await vi.waitFor(() => expect(shown.data?.id).toBe(KEPT));
    expect(forget).not.toHaveBeenCalled();
    expect(client.getQueryData(crmKeys.contact(KEPT).queryKey)).toBeUndefined();
  });
});
