import { DebugSuspense } from '@channel/DebugSuspense';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { createMemo, type FlowComponent, on } from 'solid-js';
import { QuickAccessContextProvider } from './context';
import { createQuickAccessValue } from './QuickAccessSource';
import type {
  Bucket,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from './types';

const QuickAccessProviderValue: FlowComponent = (props) => {
  const authenticated = useIsAuthenticated();
  const userId = useUserId();
  const source = createMemo(
    on(
      () => (authenticated() === true ? userId() : undefined),
      (id) => (id ? createQuickAccessValue() : undefined)
    )
  );

  const useList = ((
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList => {
    const sourceList = createMemo(() => {
      const current = source();
      if (!current) return;
      const first = args[0];
      return typeof first === 'object'
        ? current.useList(first)
        : current.useList(...(args as Bucket[]));
    });
    return {
      error: () => sourceList()?.error(),
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

  const quickAccess: QuickAccessContextValue = {
    useList,
    usesRecordSelection: () => source()?.usesRecordSelection() ?? false,
    usesSearchProjection: () => source()?.usesSearchProjection() ?? false,
    isLoading: () => source()?.isLoading() ?? false,
    refresh: () => source()?.refresh(),
    getById: (id) => source()?.getById(id),
  };

  return (
    <QuickAccessContextProvider value={quickAccess}>
      {props.children}
    </QuickAccessContextProvider>
  );
};

export const QuickAccessProvider: FlowComponent = (props) => (
  <DebugSuspense name="QuickAccess.root">
    <QuickAccessProviderValue>{props.children}</QuickAccessProviderValue>
  </DebugSuspense>
);
