import { DebugSuspense } from '@channel/DebugSuspense';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { createLazyMemo } from '@solid-primitives/memo';
import {
  createEffect,
  createMemo,
  createSignal,
  type FlowComponent,
  on,
} from 'solid-js';
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
      (id) => {
        if (!id) return;
        const [requested, setRequested] = createSignal(false);
        const value = createMemo(
          on(requested, (enabled) =>
            enabled ? createQuickAccessValue() : undefined
          )
        );
        return { value, request: () => setRequested(true) };
      }
    )
  );

  const useList = ((
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList => {
    // A mounted enabled list owns activation. Reading cached state never writes
    // the request signal or constructs account queries as a side effect.
    createEffect(() => {
      const first = args[0];
      if (typeof first === 'object' && first.enabled?.() === false) return;
      source()?.request();
    });
    const sourceList = createLazyMemo(() => {
      const first = args[0];
      if (typeof first === 'object' && first.enabled?.() === false) return;
      const current = source()?.value();
      if (!current) return;
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
    usesRecordSelection: () =>
      source()?.value()?.usesRecordSelection() ?? false,
    usesSearchProjection: () =>
      source()?.value()?.usesSearchProjection() ?? false,
    isLoading: () => source()?.value()?.isLoading() ?? false,
    refresh: () => source()?.value()?.refresh(),
    getById: (id) => source()?.value()?.getById(id),
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
