import { createSignal } from 'solid-js';

// Synthetic data at the Tasks picker service boundary; selection, search,
// focus, keyboard handling and mobile sheet remain production components.
export const useEmail = () => () => 'viewer@example.com';
export const useUserId = () => () => 'viewer';
export const useIsAuthenticated = () => () => true;
export const useAugmentUserWithDmActivity = () => (user: unknown) => user;
export const emailToId = (email: string) => email;
export const UserIcon = () => null;
export const useSearchSoupQuery = () => ({
  status: 'success',
  data: [],
  isFetching: false,
});
const pagedCompanies = new URLSearchParams(location.search).has(
  'pagedCompanies'
);
const companyNames = pagedCompanies
  ? Array.from(
      { length: 55 },
      (_, index) => `Company ${String(index).padStart(2, '0')}`
    )
  : ['Example company', 'Second company'];
const companies = companyNames.map((name, index) => ({
  kind: 'entity',
  id: `company-${index + 1}`,
  data: {
    type: 'crm_company',
    id: `company-${index + 1}`,
    name,
    updatedAt: new Date('2026-10-15'),
  },
}));
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
    const matchingCompanies = () => {
      const query = options.searchTerm?.() ?? '';
      return companies.filter((company) =>
        company.data.name.toLowerCase().includes(query)
      );
    };
    const items = () => {
      const query = options.searchTerm?.() ?? '';
      const pageSize = query ? 20 : 50;
      const loaded = loadedByQuery()[query] ?? pageSize;
      return matchingCompanies().slice(0, loaded);
    };
    return {
      items,
      totalCount: () => items().length,
      isLoading: () => false,
      isLoadingMore: loadingMore,
      error,
      hasMore: () => items().length < matchingCompanies().length,
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
