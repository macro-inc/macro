import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  useContext,
} from 'solid-js';
import type { Bucket, QuickAccessContextValue, QuickAccessList } from './types';

const QuickAccessContext = createContext<QuickAccessContextValue>();

export const QuickAccessContextProvider = QuickAccessContext.Provider;

export function useQuickAccess(): QuickAccessContextValue {
  const value = useContext(QuickAccessContext);
  if (!value) {
    throw new Error(
      'QuickAccessContext must be used within <QuickAccessContextProvider />'
    );
  }
  return value;
}

export type RegisterQuickAccessSource = (
  source: QuickAccessContextValue
) => () => void;

export type QuickAccessSourceProps = {
  registerSource: RegisterQuickAccessSource;
};

/**
 * Creates the stable context value exposed to the app while the feature flag
 * swaps the source that powers it. Lists created by already-mounted consumers
 * resolve through the current source instead of pinning the source that was
 * active when `useList` was first called.
 */
export function createQuickAccessContextFacade(): {
  value: QuickAccessContextValue;
  registerSource: RegisterQuickAccessSource;
} {
  const [source, setSource] = createSignal<
    QuickAccessContextValue | undefined
  >();

  const useList = ((...buckets: Bucket[]): QuickAccessList => {
    const sourceList = createMemo(() => source()?.useList(...buckets));
    return {
      items: () => sourceList()?.items() ?? [],
      totalCount: () => sourceList()?.totalCount() ?? 0,
      hasMore: () => sourceList()?.hasMore() ?? false,
      isLoading: () => sourceList()?.isLoading() ?? false,
      isLoadingMore: () => sourceList()?.isLoadingMore() ?? false,
      loadMore: async () => {
        await sourceList()?.loadMore();
      },
    };
  }) as QuickAccessContextValue['useList'];

  const setSearchTerm = (searchTerm: Accessor<string>) =>
    source()?.setSearchTerm(searchTerm) ?? (() => undefined);

  const value: QuickAccessContextValue = {
    useList,
    setSearchTerm,
    usesIndexedEntityQuery: () => source()?.usesIndexedEntityQuery() ?? false,
    isLoading: () => source()?.isLoading() ?? true,
    refresh: () => source()?.refresh(),
    getById: (id) => source()?.getById(id),
  };

  const registerSource: RegisterQuickAccessSource = (nextSource) => {
    setSource(nextSource);
    return () => {
      setSource((activeSource) =>
        activeSource === nextSource ? undefined : activeSource
      );
    };
  };

  return { value, registerSource };
}
