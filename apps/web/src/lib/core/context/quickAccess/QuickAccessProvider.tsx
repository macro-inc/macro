import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_SOUP_FLAG,
  ENABLE_GRAPHQL_SOUP_OVERRIDE,
} from '@core/constant/featureFlags';
import type { FlowComponent } from 'solid-js';
import { Show } from 'solid-js';
import {
  createQuickAccessContextFacade,
  QuickAccessContextProvider,
} from './context';
import { GraphqlQuickAccessSource } from './GraphqlQuickAccessSource';
import { LegacyQuickAccessSource } from './LegacyQuickAccessSource';

export const QuickAccessProvider: FlowComponent = (props) => {
  const graphqlSoupFlag = useFeatureFlag(ENABLE_GRAPHQL_SOUP_FLAG, {
    enabledOverride: ENABLE_GRAPHQL_SOUP_OVERRIDE,
  });
  const quickAccess = createQuickAccessContextFacade();

  return (
    <QuickAccessContextProvider value={quickAccess.value}>
      <Show
        when={graphqlSoupFlag().enabled}
        fallback={
          <LegacyQuickAccessSource
            registerSource={quickAccess.registerSource}
          />
        }
      >
        <GraphqlQuickAccessSource registerSource={quickAccess.registerSource} />
      </Show>
      {props.children}
    </QuickAccessContextProvider>
  );
};
