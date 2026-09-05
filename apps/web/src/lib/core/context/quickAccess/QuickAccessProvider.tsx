import { createMemo, type FlowComponent, Suspense } from 'solid-js';
import { QuickAccessContextProvider } from './context';
import { createQuickAccessValue } from './QuickAccessSource';
import type {
  Bucket,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from './types';

const QuickAccessProviderValue: FlowComponent = (props) => {
  const source = createQuickAccessValue();

  const useList = ((
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList => {
    const sourceList = createMemo(() => {
      const first = args[0];
      return typeof first === 'object'
        ? source.useList(first)
        : source.useList(...(args as Bucket[]));
    });
    return {
      items: () => sourceList().items(),
      totalCount: () => sourceList().totalCount(),
      hasMore: () => sourceList().hasMore(),
      isLoading: () => sourceList().isLoading(),
      isLoadingMore: () => sourceList().isLoadingMore(),
      loadMore: async () => {
        await sourceList().loadMore();
      },
    };
  }) as QuickAccessContextValue['useList'];

  const quickAccess: QuickAccessContextValue = {
    useList,
    usesRecordSelection: source.usesRecordSelection,
    usesSearchProjection: source.usesSearchProjection,
    isLoading: source.isLoading,
    refresh: source.refresh,
    getById: source.getById,
  };

  return (
    <QuickAccessContextProvider value={quickAccess}>
      {props.children}
    </QuickAccessContextProvider>
  );
};

export const QuickAccessProvider: FlowComponent = (props) => (
  <Suspense>
    <QuickAccessProviderValue>{props.children}</QuickAccessProviderValue>
  </Suspense>
);
