import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

// Synthetic data at the picker service boundary; selection, search, focus,
// keyboard handling and mobile sheets remain production components.
export const useEmail = () => () => 'viewer@example.com';
export const useUserId = () => () => 'viewer';
export const useIsAuthenticated = () => () => true;
export const useAugmentUserWithDmActivity = () => (user: unknown) => user;
export const emailToId = (email: string) => email;
export const UserIcon = () => null;
export const validateSearchServiceText = (text: string) =>
  text.trim().length > 0;

const params = new URLSearchParams(location.search);
const selector = params.get('selector');
const pagedCompanies = params.has('pagedCompanies');
const numberedNames = (prefix: string) =>
  Array.from(
    { length: 55 },
    (_, index) => `${prefix} ${String(index).padStart(2, '0')}`
  );
const itemPrefix = match(selector)
  .with('CONTACT', () => 'Contact')
  .with('THREAD', () => 'Cached email')
  .otherwise(() => 'Task');
const recordCompanyNames = pagedCompanies
  ? numberedNames('Company')
  : ['Example company', 'Second company'];
const itemNames = selector ? numberedNames(itemPrefix) : recordCompanyNames;
const itemType = match(selector)
  .with('CONTACT', () => 'crm_contact')
  .with('THREAD', () => 'email')
  .with('TASK', 'MIXED', 'GENERIC', () => 'document')
  .otherwise(() => 'crm_company');
const hasTaskSubtype =
  selector === 'TASK' || selector === 'MIXED' || selector === 'GENERIC';
const quickAccessItems = itemNames.map((name, index) => {
  const id = selector ? `cached-${index + 1}` : `company-${index + 1}`;
  return {
    kind: 'entity',
    id,
    data: {
      type: itemType,
      id,
      name,
      fileType: hasTaskSubtype ? 'md' : undefined,
      subType: hasTaskSubtype ? { type: 'task' } : undefined,
      email:
        itemType === 'crm_contact'
          ? `person${index + 1}@example.com`
          : undefined,
      updatedAt: new Date('2026-10-15'),
    },
  };
});
const [loadedByQuery, setLoadedByQuery] = createSignal<Record<string, number>>(
  {}
);
const [loadingMore, setLoadingMore] = createSignal(false);
const [error, setError] = createSignal<unknown>();
let holdNext = false;
let failNext = false;
let releaseNext: (() => void) | undefined;

export const useQuickAccess = () => ({
  isLoading: () => false,
  useList: (options: { searchTerm?: () => string }) => {
    const matchingItems = () => {
      const query = options.searchTerm?.() ?? '';
      return quickAccessItems.filter((item) =>
        item.data.name.toLowerCase().includes(query)
      );
    };
    const items = () => {
      const query = options.searchTerm?.() ?? '';
      const pageSize = query ? 20 : 50;
      const loaded = loadedByQuery()[query] ?? pageSize;
      return matchingItems().slice(0, loaded);
    };
    return {
      items,
      totalCount: () => items().length,
      isLoading: () => false,
      isLoadingMore: loadingMore,
      error,
      hasMore: () => items().length < matchingItems().length,
      loadMore: async () => {
        const query = options.searchTerm?.() ?? '';
        const pageSize = query ? 20 : 50;
        setLoadingMore(true);
        try {
          if (holdNext) {
            await new Promise<void>((resolve) => {
              releaseNext = resolve;
            });
          }
          holdNext = false;
          if (failNext) {
            failNext = false;
            setError(new Error('Synthetic page failure'));
            return;
          }
          setLoadedByQuery((loaded) => ({
            ...loaded,
            [query]: (loaded[query] ?? pageSize) + pageSize,
          }));
          setError(undefined);
        } finally {
          setLoadingMore(false);
        }
      },
    };
  },
});

const remoteEmails = numberedNames('Remote email').map((name, index) => ({
  type: 'email',
  id: `remote-${index + 1}`,
  name,
  updatedAt: new Date('2026-10-15'),
}));
const [searchLoaded, setSearchLoaded] = createSignal(20);
const [searchLoadingMore, setSearchLoadingMore] = createSignal(false);

export const useSearchSoupQuery = (
  args: () => { body: { query: string } },
  options?: () => { enabled?: boolean }
) => {
  const query = () => args().body.query.toLowerCase();
  const enabled = () =>
    options?.().enabled !== false && validateSearchServiceText(query());
  const matchingEmails = () =>
    remoteEmails.filter((email) => email.name.toLowerCase().includes(query()));
  const items = () =>
    enabled() ? matchingEmails().slice(0, searchLoaded()) : [];
  return {
    status: 'success',
    get data() {
      return items();
    },
    get isFetching() {
      return searchLoadingMore();
    },
    get isFetchingNextPage() {
      return searchLoadingMore();
    },
    get hasNextPage() {
      return enabled() && items().length < matchingEmails().length;
    },
    error: undefined,
    fetchNextPage: async () => {
      if (!enabled()) return;
      setSearchLoadingMore(true);
      try {
        setSearchLoaded((loaded) => loaded + 20);
      } finally {
        setSearchLoadingMore(false);
      }
    },
  };
};

Object.assign(window, {
  companyPickerFixture: {
    holdNext() {
      holdNext = true;
    },
    failNext() {
      failNext = true;
    },
    release() {
      releaseNext?.();
      releaseNext = undefined;
    },
  },
});

declare global {
  interface Window {
    companyPickerFixture: {
      holdNext(): void;
      failNext(): void;
      release(): void;
    };
  }
}
