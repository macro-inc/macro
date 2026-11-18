import { throwOnErr } from '@core/util/result';
import type { CompanyContactsPageResponse } from '@service-storage/generated/schemas/companyContactsPageResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
} from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type {
  CompanyContactsFilter,
  CompanyContactsSource,
} from '../context/crm-sources';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

/** Contacts per Team list page. */
export const COMPANY_CONTACTS_PAGE_SIZE = 50;
const COMPANY_CONTACTS_STALE_TIME = 60 * 1000;

// Each page names the search it answers, so a placeholder can tell whether
// narrowing its rows on the client already gives the new search's answer.
type CompanyContactsPage = CompanyContactsPageResponse & { search: string };
type CompanyContactsData = InfiniteData<CompanyContactsPage, string | null>;

/** The company a Team list query belongs to (`['crm', 'companyContacts', id, ...]`). */
function companyOfKey(queryKey: QueryKey): string | undefined {
  const companyId = queryKey[2];
  return typeof companyId === 'string' ? companyId : undefined;
}

function companyContactsQueryOptions(
  deps: CrmRecordDependencies,
  filter: CompanyContactsFilter
) {
  return infiniteQueryOptions({
    queryKey: [
      ...crmKeys.companyContacts(filter.companyId).queryKey,
      filter.archived,
      filter.search,
    ],
    queryFn: async ({ pageParam }): Promise<CompanyContactsPage> => ({
      ...(await throwOnErr(() =>
        deps.storage.listCompanyContactsPage({
          companyId: filter.companyId,
          archived: filter.archived,
          query: filter.search || undefined,
          cursor: pageParam ?? undefined,
          limit: COMPANY_CONTACTS_PAGE_SIZE,
        })
      )),
      search: filter.search,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: COMPANY_CONTACTS_STALE_TIME,
    enabled: !!filter.companyId,
    // A new search keeps the previous search's rows, which the list narrows
    // itself, until its own first page arrives; another company or archive
    // state starts from a skeleton.
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      return key?.[2] === filter.companyId && key?.[3] === filter.archived
        ? previous
        : undefined;
    },
  });
}

/**
 * The rows of loaded pages in order, each contact once. A contact renamed
 * between page loads can move onto a later page and arrive twice; the first
 * copy stays.
 */
export function flattenCompanyContactsPages(
  pages: readonly { contacts: readonly CrmContactResponse[] }[]
): CrmContactResponse[] {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.contacts.filter((contact) => {
      if (seen.has(contact.id)) return false;
      seen.add(contact.id);
      return true;
    })
  );
}

const NO_FILTER: CompanyContactsFilter = {
  companyId: '',
  archived: false,
  search: '',
};

/**
 * A company's Team list a page at a time via
 * `GET /crm/companies/{id}/contacts/page`, in the server's order (name, then
 * email). Disabled while `filter` is undefined.
 */
export function useCompanyContactsQuery(
  deps: CrmRecordDependencies,
  filter: Accessor<CompanyContactsFilter | undefined>
): CompanyContactsSource {
  const query = useInfiniteQuery(
    () => companyContactsQueryOptions(deps, filter() ?? NO_FILTER),
    () => deps.client
  );
  // A failed continuation keeps its loaded pages (status `error` with data),
  // so rows are read whenever there is data, never only on `isSuccess`. With
  // no data, `data` is not read: that read would suspend on the next retry.
  const contacts = createMemo<CrmContactResponse[]>(() =>
    query.isPending || query.isLoadingError
      ? []
      : flattenCompanyContactsPages(query.data.pages)
  );
  return {
    get contacts() {
      return contacts();
    },
    get loadedSearch() {
      return query.isPending || query.isLoadingError
        ? undefined
        : query.data.pages[0]?.search;
    },
    get isPending() {
      return query.isPending;
    },
    get isSearching() {
      if (!query.isPlaceholderData) return false;
      const pages = query.data?.pages ?? [];
      const previous = pages[0]?.search;
      const current = filter()?.search ?? '';
      // Narrowing a complete list on the client is already the answer.
      return !(
        previous !== undefined &&
        !pages.at(-1)?.nextCursor &&
        current.toLowerCase().includes(previous.toLowerCase())
      );
    },
    // Like `recordListFailure`: a failed refetch means the loaded rows may no
    // longer be current (access revoked), so only a continuation keeps them.
    get isError() {
      return query.isError && !query.isFetchNextPageError;
    },
    // A placeholder's cursor belongs to the previous search.
    get hasNextPage() {
      return query.hasNextPage && !query.isPlaceholderData;
    },
    get isFetchingNextPage() {
      return query.isFetchingNextPage;
    },
    get isFetchNextPageError() {
      return query.isFetchNextPageError;
    },
    fetchNextPage: () => query.fetchNextPage(),
    refetch: () => query.refetch(),
  };
}

/** Whether a query is one of the Team lists of `companyId`, or of any company. */
export function isCompanyContactsQuery(
  queryKey: QueryKey,
  companyId?: string | null
): boolean {
  if (queryKey[0] !== 'crm' || queryKey[1] !== 'companyContacts') return false;
  return companyId === undefined || companyOfKey(queryKey) === companyId;
}

/** Whether a cached Team list holds the contact. */
export function companyContactsHold(data: unknown, contactId: string): boolean {
  const pages = (data as CompanyContactsData | undefined)?.pages;
  return (
    Array.isArray(pages) &&
    pages.some((page) =>
      page.contacts.some((contact) => contact.id === contactId)
    )
  );
}

/**
 * Rewrites every cached Team list row; returning `undefined` drops the row.
 * Pages and cursors are kept, so later pages still continue from the server.
 */
export function patchCompanyContacts(
  client: QueryClient,
  patch: (
    contact: CrmContactResponse,
    companyId: string
  ) => CrmContactResponse | undefined
) {
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: crmKeys.companyContacts._def })) {
    const companyId = companyOfKey(query.queryKey);
    const data = query.state.data as CompanyContactsData | undefined;
    if (!companyId || !data?.pages) continue;
    let changed = false;
    const pages = data.pages.map((page) => {
      let pageChanged = false;
      const contacts: CrmContactResponse[] = [];
      for (const contact of page.contacts) {
        const next = patch(contact, companyId);
        if (next !== contact) pageChanged = true;
        if (next) contacts.push(next);
      }
      if (!pageChanged) return page;
      changed = true;
      return { ...page, contacts };
    });
    if (changed) client.setQueryData(query.queryKey, { ...data, pages });
  }
}
