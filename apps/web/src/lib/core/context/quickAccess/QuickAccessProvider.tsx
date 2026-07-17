import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_SOUP_FLAG,
  ENABLE_GRAPHQL_SOUP_OVERRIDE,
} from '@core/constant/featureFlags';
import { createMemo, type FlowComponent } from 'solid-js';
import { QuickAccessContextProvider } from './context';
import { createGraphqlQuickAccessValue } from './GraphqlQuickAccessSource';
import { createLegacyQuickAccessValue } from './LegacyQuickAccessSource';
import type {
  Bucket,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from './types';

export const QuickAccessProvider: FlowComponent = (props) => {
  const graphqlSoupFlag = useFeatureFlag(ENABLE_GRAPHQL_SOUP_FLAG, {
    enabledOverride: ENABLE_GRAPHQL_SOUP_OVERRIDE,
  });

  const source = createMemo(() =>
    graphqlSoupFlag().enabled
      ? createGraphqlQuickAccessValue()
      : createLegacyQuickAccessValue()
  );

  const useList = ((
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList => {
    const sourceList = createMemo(() => {
      const first = args[0];
      return typeof first === 'object'
        ? source().useList(first)
        : source().useList(...(args as Bucket[]));
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
    usesRecordSelection: () => source().usesRecordSelection(),
    isLoading: () => source().isLoading(),
    refresh: () => source().refresh(),
    getById: (id) => source().getById(id),
  };

  return (
    <QuickAccessContextProvider value={quickAccess}>
      {props.children}
    </QuickAccessContextProvider>
  );
};
