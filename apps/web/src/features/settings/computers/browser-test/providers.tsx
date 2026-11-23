import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { EntityProvider } from '@entity';
import { staticChannelDirectory } from '@queries/channel/directory';
import type { ParentProps } from 'solid-js';

// Mentions are not under test: an empty Quick Access source.
const QUICK_ACCESS: QuickAccessContextValue = {
  useList: (() => ({
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    loadMore: async () => {},
  })) as QuickAccessContextValue['useList'],
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

/** The app-shell contexts the agent editor reads. */
export function FixtureProviders(props: ParentProps) {
  return (
    <AnalyticsContextProvider>
      <EntityProvider>
        <EmailLinksContextProvider>
          <ChannelDirectoryProvider
            directory={staticChannelDirectory(() => [])}
          >
            <QuickAccessContextProvider value={QUICK_ACCESS}>
              <MobileSettingsProvider>{props.children}</MobileSettingsProvider>
            </QuickAccessContextProvider>
          </ChannelDirectoryProvider>
        </EmailLinksContextProvider>
      </EntityProvider>
    </AnalyticsContextProvider>
  );
}
