import { QueryClient } from '@tanstack/solid-query';
import { expect, it } from 'vitest';
import { crmKeys } from './keys';
import {
  patchVisibilitySnapshot,
  updateVisibilityDetails,
  visibilityDetailsFilter,
  visibilityQueryFilter,
} from './visibility-refresh';

it('updates cached suggestion pages and parent contacts without touching documents, dates, cursors or other companies', () => {
  const date = new Date('2026-10-15');
  const data = {
    pages: [
      {
        contacts: [
          {
            __typename: 'GraphqlSoupCrmContact',
            id: 'contact-1',
            contactCompanyId: 'company-1',
            hidden: false,
          },
          {
            __typename: 'GraphqlSoupCrmContact',
            id: 'contact-2',
            contactCompanyId: 'company-2',
            hidden: false,
          },
        ],
        items: [
          { tag: 'crmCompany', data: { id: 'company-1', hidden: false } },
          { tag: 'document', data: { id: 'company-1', hidden: false, date } },
        ],
        nextCursor: 'next',
      },
    ],
    pageParams: [null],
  };
  const result = patchVisibilitySnapshot(data, {
    kind: 'company',
    id: 'company-1',
    hidden: true,
  }) as typeof data;
  expect(result.pages[0].contacts.map((contact) => contact.hidden)).toEqual([
    true,
    false,
  ]);
  expect(result.pages[0].items[0].data.hidden).toBe(true);
  expect(result.pages[0].items[1]).toEqual(data.pages[0].items[1]);
  expect(result.pages[0].items[1].data.date).toBe(date);
  expect(result.pages[0].nextCursor).toBe('next');
  expect(result.pageParams).toEqual([null]);
});

it('scopes paginated grouped refreshes using the body rather than the params', () => {
  const client = new QueryClient();
  const affected = [
    'soup',
    'groupedGroup',
    'group',
    'one',
    'none',
    { limit: 25 },
    { crmf: { l: { hidden: false } } },
  ];
  const other = [
    'soup',
    'groupedGroup',
    'group',
    'two',
    'none',
    { limit: 25 },
    { df: {} },
  ];
  for (const key of [affected, other, ['settings']])
    client.setQueryData(key, {});
  expect(
    client
      .getQueryCache()
      .findAll({
        predicate: visibilityQueryFilter({
          kind: 'contact',
          id: 'contact-1',
          hidden: true,
        }),
      })
      .map((q) => q.queryKey)
  ).toEqual([affected]);
  client.clear();
});

it('cancels pre-save REST reads before applying confirmed state', async () => {
  const client = new QueryClient();
  const key = crmKeys.contact('contact-1').queryKey;
  const contact = { id: 'contact-1', companyId: 'company-1', hidden: false };
  client.setQueryData(key, contact);
  let release!: (value: typeof contact) => void;
  const read = client
    .fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<typeof contact>((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => undefined);
  await updateVisibilityDetails(client, {
    kind: 'contact',
    id: 'contact-1',
    hidden: true,
  });
  release(contact);
  await read;
  expect(client.getQueryData(key)).toEqual({ ...contact, hidden: true });
  client.clear();
});

it('patches company-capable search pages and cancels old responses without touching unrelated search', async () => {
  const client = new QueryClient();
  const companyKey = [
    'soup',
    'search',
    { page_size: 20 },
    { query: 'example', include_crm: true },
  ];
  const documentKey = ['soup', 'search', {}, { query: 'example' }];
  const otherCompanyKey = [
    'soup',
    'search',
    {},
    {
      query: 'example',
      include_crm: true,
      filters: { crm_company_filters: { company_ids: ['company-2'] } },
    },
  ];
  const page = {
    pages: [
      {
        results: [
          { type: 'company', id: 'company-1', hidden: false },
          { type: 'document', id: 'company-1', hidden: false },
        ],
        next_cursor: 'more',
      },
    ],
    pageParams: [null],
  };
  for (const key of [companyKey, documentKey, otherCompanyKey])
    client.setQueryData(key, page);
  let release!: (value: typeof page) => void;
  const read = client
    .fetchQuery({
      queryKey: companyKey,
      queryFn: () =>
        new Promise<typeof page>((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => undefined);
  await updateVisibilityDetails(client, {
    kind: 'company',
    id: 'company-1',
    hidden: true,
  });
  release(page);
  await read;
  expect(client.getQueryData(companyKey)).toEqual({
    ...page,
    pages: [
      {
        ...page.pages[0],
        results: [
          { type: 'company', id: 'company-1', hidden: true },
          page.pages[0].results[1],
        ],
      },
    ],
  });
  expect(client.getQueryData(documentKey)).toEqual(page);
  expect(client.getQueryData(otherCompanyKey)).toEqual(page);
  await updateVisibilityDetails(client, {
    kind: 'company',
    id: 'company-1',
    hidden: false,
  });
  expect(client.getQueryData(companyKey)).toEqual(page);
  client.clear();
});

it('archives a contact in place in Team lists and refreshes only the lists it can move between', async () => {
  const client = new QueryClient();
  const row = { id: 'contact-1', companyId: 'company-1', hidden: false };
  const team = (companyId: string, archived: boolean) => [
    ...crmKeys.companyContacts(companyId).queryKey,
    archived,
    '',
  ];
  const page = {
    pages: [{ contacts: [row], nextCursor: null, search: '' }],
    pageParams: [null],
  };
  client.setQueryData(team('company-1', false), page);
  client.setQueryData(team('company-1', true), {
    pages: [{ contacts: [], nextCursor: null, search: '' }],
    pageParams: [null],
  });
  client.setQueryData(team('company-2', false), page);
  const affected = (change: Parameters<typeof visibilityDetailsFilter>[0]) =>
    client
      .getQueryCache()
      .findAll({ predicate: visibilityDetailsFilter(change) })
      .map((query) => query.queryKey);

  expect(affected({ kind: 'company', id: 'company-1', hidden: true })).toEqual([
    team('company-1', false),
    team('company-1', true),
  ]);
  expect(affected({ kind: 'contact', id: 'contact-1', hidden: true })).toEqual([
    team('company-1', false),
    team('company-1', true),
    team('company-2', false),
  ]);

  await updateVisibilityDetails(client, {
    kind: 'contact',
    id: 'contact-1',
    hidden: true,
  });
  expect(client.getQueryData(team('company-1', false))).toEqual({
    ...page,
    pages: [{ ...page.pages[0], contacts: [{ ...row, hidden: true }] }],
  });
  client.clear();
});

it("archives a contact detail's company summary with its company", async () => {
  const client = new QueryClient();
  const current = crmKeys.contact('contact-1').queryKey;
  const former = crmKeys.contact('contact-2').queryKey;
  const company = { id: 'company-1', name: 'Acme', hidden: false };
  client.setQueryData(current, {
    id: 'contact-1',
    companyId: 'company-1',
    hidden: false,
    company,
  });
  client.setQueryData(former, {
    id: 'contact-2',
    companyId: 'company-2',
    hidden: false,
    company: { ...company, id: 'company-2' },
  });
  await updateVisibilityDetails(client, {
    kind: 'company',
    id: 'company-1',
    hidden: true,
  });
  expect(client.getQueryData(current)).toEqual({
    id: 'contact-1',
    companyId: 'company-1',
    hidden: true,
    company: { ...company, hidden: true },
  });
  expect(client.getQueryData(former)).toMatchObject({
    hidden: false,
    company: { hidden: false },
  });
  client.clear();
});
