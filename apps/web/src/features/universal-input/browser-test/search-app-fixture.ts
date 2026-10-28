import { createSignal } from 'solid-js';
import type { CommandContactSource } from '../../command/useCommandItems';

export const [openedSearchResult, setOpenedSearchResult] =
  createSignal<unknown>();
export function useSplitLayout() {
  return {
    openWithSplit: (content: unknown, options: unknown) => {
      setOpenedSearchResult({ content, options });
      return { status: 'opened' };
    },
  };
}
export function useCrmContactDiscovery(): CommandContactSource {
  return {
    contacts: () => [],
    isLoading: () => false,
    error: () => undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  };
}
export function useDatabaseDiscoverySync() {}
export async function createDatabase(): Promise<never> {
  throw new Error('Database creation is outside this fixture');
}

export function useAnalytics() {
  return { track: () => {} };
}

export function useForegroundMobileView() {
  return () => 'search';
}

export function useMobileNavNavigate() {
  return (view: string) => setOpenedSearchResult({ view });
}
