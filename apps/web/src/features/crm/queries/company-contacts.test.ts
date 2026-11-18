import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import {
  createComponent,
  createMemo,
  createRoot,
  createSignal,
  type JSX,
  Suspense,
} from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import type {
  CompanyContactsFilter,
  CompanyContactsSource,
} from '../context/crm-sources';
import {
  companyContactsHold,
  flattenCompanyContactsPages,
  isCompanyContactsQuery,
  patchCompanyContacts,
  useCompanyContactsQuery,
} from './company-contacts';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

const contact = (id: string, companyId: string): CrmContactResponse => ({
  id,
  companyId,
  name: id,
  hidden: false,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  firstInteraction: '2026-10-01',
  lastInteraction: '2026-10-01',
});
const teamKey = (companyId: string, archived = false, search = '') => [
  ...crmKeys.companyContacts(companyId).queryKey,
  archived,
  search,
];
const pages = (...rows: CrmContactResponse[][]) => ({
  pages: rows.map((contacts, index) => ({
    contacts,
    nextCursor: index < rows.length - 1 ? `cursor-${index}` : null,
    search: '',
  })),
  pageParams: rows.map((_, index) => (index ? `cursor-${index - 1}` : null)),
});

it('recognizes a Team list by company', () => {
  expect(isCompanyContactsQuery(teamKey('company-1'))).toBe(true);
  expect(isCompanyContactsQuery(teamKey('company-1'), 'company-1')).toBe(true);
  expect(isCompanyContactsQuery(teamKey('company-1'), 'company-2')).toBe(false);
  expect(isCompanyContactsQuery(crmKeys.company('company-1').queryKey)).toBe(
    false
  );
  expect(companyContactsHold(pages([contact('a', 'c')]), 'a')).toBe(true);
  expect(companyContactsHold(pages([contact('a', 'c')]), 'b')).toBe(false);
  expect(companyContactsHold(undefined, 'a')).toBe(false);
});

it('patches and drops rows in every cached page, keeping untouched pages and cursors', () => {
  const client = new QueryClient();
  const first = [contact('a', 'company-1'), contact('b', 'company-1')];
  const second = [contact('c', 'company-1')];
  const other = pages([contact('d', 'company-2')]);
  client.setQueryData(teamKey('company-1'), pages(first, second));
  client.setQueryData(teamKey('company-2'), other);

  patchCompanyContacts(client, (row, companyId) => {
    if (row.id === 'a') return { ...row, name: `renamed in ${companyId}` };
    if (row.id === 'b') return undefined;
    return row;
  });

  const patched = client.getQueryData<ReturnType<typeof pages>>(
    teamKey('company-1')
  );
  expect(patched?.pages[0].contacts).toEqual([
    { ...first[0], name: 'renamed in company-1' },
  ]);
  expect(patched?.pages[0].nextCursor).toBe('cursor-0');
  expect(patched?.pages[1].contacts).toBe(second);
  expect(patched?.pageParams).toEqual([null, 'cursor-0']);
  expect(client.getQueryData(teamKey('company-2'))).toBe(other);
  client.clear();
});

it('lists a contact that arrives on two pages once, where it came first', () => {
  const renamed = contact('b', 'company-1');
  const { pages: loaded } = pages(
    [contact('a', 'company-1'), renamed],
    [{ ...renamed, name: 'z renamed' }, contact('c', 'company-1')]
  );
  expect(flattenCompanyContactsPages(loaded)).toEqual([
    contact('a', 'company-1'),
    renamed,
    contact('c', 'company-1'),
  ]);
});

it('names the search its rows answer, the earlier one while the next is loading', async () => {
  const held = Promise.withResolvers<void>();
  const listCompanyContactsPage = vi.fn(
    async ({ query }: { query?: string }) => {
      if (query) await held.promise;
      return ok({
        contacts: [contact(query ?? 'all', 'company-1')],
        nextCursor: null,
      });
    }
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const deps = {
    client,
    storage: { listCompanyContactsPage },
  } as unknown as CrmRecordDependencies;
  const [filter, setFilter] = createSignal<CompanyContactsFilter>({
    companyId: 'company-1',
    archived: false,
    search: '',
  });
  const { source, dispose } = createRoot((dispose) => ({
    source: useCompanyContactsQuery(deps, filter),
    dispose,
  }));

  await vi.waitFor(() => expect(source.loadedSearch).toBe(''));
  setFilter({ companyId: 'company-1', archived: false, search: 'an' });
  await vi.waitFor(() =>
    expect(listCompanyContactsPage).toHaveBeenCalledTimes(2)
  );
  expect(source.loadedSearch).toBe('');
  expect(source.contacts.map((row) => row.id)).toEqual(['all']);

  held.resolve();
  await vi.waitFor(() => expect(source.loadedSearch).toBe('an'));
  expect(source.contacts.map((row) => row.id)).toEqual(['an']);
  dispose();
  client.clear();
});

it('keeps loaded rows when a continuation fails, and reports a failed refetch', async () => {
  let fail = false;
  const listCompanyContactsPage = vi.fn(
    async ({ cursor }: { cursor?: string }) => {
      if (fail) return err([{ code: 'HTTP_ERROR', message: 'unavailable' }]);
      return ok({
        contacts: [contact(cursor ?? 'first', 'company-1')],
        nextCursor: cursor ? null : 'second',
      });
    }
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const deps = {
    client,
    storage: { listCompanyContactsPage },
  } as unknown as CrmRecordDependencies;
  const { source, dispose } = createRoot((dispose) => ({
    source: useCompanyContactsQuery(deps, () => ({
      companyId: 'company-1',
      archived: false,
      search: 'a',
    })),
    dispose,
  }));
  await vi.waitFor(() => expect(source.contacts).toHaveLength(1));

  fail = true;
  await source.fetchNextPage();
  expect(source.isFetchNextPageError).toBe(true);
  expect(source.isError).toBe(false);
  expect(source.contacts.map((row) => row.id)).toEqual(['first']);
  expect(source.loadedSearch).toBe('a');

  await source.refetch();
  expect(source.isError).toBe(true);
  expect(source.contacts.map((row) => row.id)).toEqual(['first']);
  expect(source.loadedSearch).toBe('a');
  dispose();
  client.clear();
});

it('reports an error when the first page fails', async () => {
  const listCompanyContactsPage = vi.fn(async () =>
    err([{ code: 'HTTP_ERROR', message: 'unavailable' }])
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const deps = {
    client,
    storage: { listCompanyContactsPage },
  } as unknown as CrmRecordDependencies;
  const { source, dispose } = createRoot((dispose) => ({
    source: useCompanyContactsQuery(deps, () => ({
      companyId: 'company-1',
      archived: false,
      search: '',
    })),
    dispose,
  }));
  await vi.waitFor(() => expect(source.isError).toBe(true));
  expect(source.contacts).toEqual([]);
  expect(source.loadedSearch).toBeUndefined();
  dispose();
  client.clear();
});

it('retries a failed search without suspending the list', async () => {
  const listCompanyContactsPage = vi.fn(
    async ({ query }: { query?: string }) =>
      query === 'ab'
        ? err([{ code: 'HTTP_ERROR', message: 'unavailable' }])
        : ok({
            contacts: [contact(query ?? 'all', 'company-1')],
            nextCursor: null,
          })
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const deps = {
    client,
    storage: { listCompanyContactsPage },
  } as unknown as CrmRecordDependencies;
  const [search, setSearch] = createSignal('');
  let source!: CompanyContactsSource;
  let fallbacks = 0;
  let child: JSX.Element;
  function List() {
    source = useCompanyContactsQuery(deps, () => ({
      companyId: 'company-1',
      archived: false,
      search: search(),
    }));
    return createMemo(
      () => `${source.contacts.map((row) => row.id)}|${source.loadedSearch}`
    ) as unknown as JSX.Element;
  }
  const element = document.createElement('div');
  const dispose = render(
    () =>
      createComponent(Suspense, {
        get fallback() {
          fallbacks++;
          return 'loading';
        },
        get children() {
          child ??= createComponent(List, {});
          return child;
        },
      }),
    element
  );
  await vi.waitFor(() => expect(element.textContent).toBe('all|'));

  setSearch('ab');
  await vi.waitFor(() => expect(source.isError).toBe(true));
  const before = fallbacks;
  await source.refetch();
  await vi.waitFor(() =>
    expect(listCompanyContactsPage).toHaveBeenCalledTimes(3)
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fallbacks).toBe(before);
  expect(source.contacts).toEqual([]);
  dispose();
  client.clear();
});
