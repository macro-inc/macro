import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient } from '@tanstack/solid-query';
import { expect, it } from 'vitest';
import {
  contactEditDetailsFilter,
  updateContactEditDetails,
} from './contact-edit-refresh';
import { crmKeys } from './keys';

const before: CrmContactResponse = {
  id: 'contact-1',
  companyId: 'company-1',
  email: 'old@example.com',
  name: 'Example person',
  hidden: true,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
};
const after = {
  ...before,
  companyId: 'company-2',
  email: 'new@example.com',
  updatedAt: '2026-10-02',
};
const company = (
  id: string,
  contacts: CrmContactResponse[]
): CrmCompanyResponse => ({
  id,
  contacts,
  teamId: 'team-1',
  hidden: false,
  emailSync: true,
  domains: [],
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
});

it('moves only the committed contact and clears the old address lookup without merging another contact', async () => {
  const client = new QueryClient();
  const duplicate = { ...before, id: 'contact-2' };
  client.setQueryData(crmKeys.contact(before.id).queryKey, before);
  client.setQueryData(
    crmKeys.company('company-1').queryKey,
    company('company-1', [before, duplicate])
  );
  client.setQueryData(
    crmKeys.company('company-2').queryKey,
    company('company-2', [])
  );
  client.setQueryData(
    crmKeys.company('unrelated').queryKey,
    company('unrelated', [])
  );
  client.setQueryData(
    crmKeys.contactByEmail('team-1', before.email!).queryKey,
    before
  );
  client.setQueryData(
    crmKeys.contactByEmail('team-2', before.email!).queryKey,
    duplicate
  );
  expect(
    await updateContactEditDetails(client, before, after, () => true)
  ).toBe(true);
  expect(client.getQueryData(crmKeys.contact(before.id).queryKey)).toEqual(
    after
  );
  expect(
    client.getQueryData<CrmCompanyResponse>(
      crmKeys.company('company-1').queryKey
    )?.contacts
  ).toEqual([duplicate]);
  expect(
    client.getQueryData<CrmCompanyResponse>(
      crmKeys.company('company-2').queryKey
    )?.contacts
  ).toEqual([after]);
  expect(
    client.getQueryData(
      crmKeys.contactByEmail('team-1', before.email!).queryKey
    )
  ).toBeNull();
  expect(
    client.getQueryData(
      crmKeys.contactByEmail('team-2', before.email!).queryKey
    )
  ).toEqual(duplicate);
  expect(
    client.getQueryState(crmKeys.company('unrelated').queryKey)?.isInvalidated
  ).toBe(false);
  client.clear();
});

it('cancels a slow pre-edit detail read before applying success', async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  client.setQueryData(key, before);
  let release!: (contact: CrmContactResponse) => void;
  const read = client
    .fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<CrmContactResponse>((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => undefined);
  await updateContactEditDetails(client, before, after, () => true);
  release(before);
  await read;
  expect(client.getQueryData(key)).toEqual(after);
  client.clear();
});

it('ignores a late response after session replacement or a newer committed edit', async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  client.setQueryData(key, before);
  expect(
    await updateContactEditDetails(client, before, after, () => false)
  ).toBe(false);
  expect(client.getQueryData(key)).toEqual(before);
  const newer = {
    ...after,
    email: null,
    companyId: null,
    updatedAt: '2026-10-03',
  };
  client.setQueryData(key, newer);
  expect(
    await updateContactEditDetails(client, before, after, () => true)
  ).toBe(false);
  expect(client.getQueryData(key)).toEqual(newer);
  client.clear();
});

it('scopes invalidation to both company sides, contact identity and affected addresses', () => {
  const client = new QueryClient();
  for (const key of [
    crmKeys.contact(before.id).queryKey,
    crmKeys.contact('other').queryKey,
    crmKeys.company('company-1').queryKey,
    crmKeys.company('company-2').queryKey,
    crmKeys.company('other').queryKey,
    ['settings'],
  ])
    client.setQueryData(key, {});
  expect(
    client
      .getQueryCache()
      .findAll({ predicate: contactEditDetailsFilter(client, before, after) })
      .map((query) => query.queryKey)
  ).toEqual([
    crmKeys.contact(before.id).queryKey,
    crmKeys.company('company-1').queryKey,
    crmKeys.company('company-2').queryKey,
  ]);
  client.clear();
});

it('keeps a newer archive and name when an older field response arrives without a changed archive timestamp', async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  const newer = { ...before, hidden: true, name: 'Renamed person' };
  client.setQueryData(key, newer);
  const stale = { ...after, hidden: false, name: 'Old person' };
  await updateContactEditDetails(client, before, stale, () => true);
  expect(client.getQueryData(key)).toEqual({
    ...after,
    hidden: true,
    name: 'Renamed person',
  });
  client.clear();
});

it('recognizes conflicting intermediate fields and includes their parent for authoritative refresh', async () => {
  const client = new QueryClient();
  client.setQueryData(crmKeys.contact(before.id).queryKey, before);
  for (const id of ['company-1', 'company-2', 'company-3'])
    client.setQueryData(
      crmKeys.company(id).queryKey,
      company(id, id === before.companyId ? [before] : [])
    );
  await updateContactEditDetails(client, before, after, () => true);
  const latest = { ...after, companyId: 'company-3', updatedAt: '2026-10-03' };
  const predicate = contactEditDetailsFilter(client, before, latest);
  expect(
    await updateContactEditDetails(
      client,
      before,
      latest,
      () => true,
      predicate
    )
  ).toBe(false);
  expect(
    client
      .getQueryCache()
      .findAll({ predicate })
      .map((query) => query.queryKey)
  ).toContainEqual(crmKeys.company('company-2').queryKey);
  client.clear();
});

it('cancels an intermediate parent read even before that company has cached data', async () => {
  const client = new QueryClient();
  client.setQueryData(crmKeys.contact(before.id).queryKey, after);
  const key = crmKeys.company('company-2').queryKey;
  let release!: (value: CrmCompanyResponse) => void;
  const read = client
    .fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<CrmCompanyResponse>((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => undefined);
  const latest = { ...after, companyId: 'company-3', updatedAt: '2026-10-03' };
  await updateContactEditDetails(client, before, latest, () => true);
  release(company('company-2', [after]));
  await read;
  expect(client.getQueryData(key)).toBeUndefined();
  client.clear();
});

it('applies confirmed fields when an overlapping rename has a later transaction timestamp', async () => {
  const client = new QueryClient();
  const key = crmKeys.contact(before.id).queryKey;
  client.setQueryData(key, {
    ...before,
    name: 'Renamed person',
    updatedAt: '2026-10-04',
  });
  expect(
    await updateContactEditDetails(client, before, after, () => true)
  ).toBe(true);
  expect(client.getQueryData(key)).toEqual({
    ...after,
    name: 'Renamed person',
  });
  client.clear();
});
