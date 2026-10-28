import '@fontsource-variable/inter';
import '../../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type {
  Bucket,
  ItemForBucket,
  ItemsForBuckets,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { syncServiceClient } from '@service-sync/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { HistoryProvider, useHistory } from '../HistoryContext';
import { HistoryOverlay } from '../HistoryOverlay';
import { HistoryScrubber } from '../HistoryScrubber';
import { HistorySessionList } from '../HistorySessionList';
import { buildLargeDoc } from '../testing/history-doc';

// The history UI over a long generated history, with the sync service
// answered in-page instead of over the network.
const sessionCount = Number(
  new URLSearchParams(location.search).get('sessions') ?? '300'
);
// Sessions are about 75 minutes apart; end the history around now so the
// session list spreads them over its recent rows.
const doc = buildLargeDoc(
  sessionCount,
  Math.floor(Date.now() / 1000) - sessionCount * 4500
);
const snapshot = new Uint8Array(doc.export({ mode: 'snapshot' }));
const latest = doc.toJSON();

syncServiceClient.getSnapshot = async () => ok(snapshot);
syncServiceClient.getDocumentMetadata = async () =>
  ok({
    peers: [1, 2, 3].map((peer) => ({
      peer_id: peer,
      user_id: `macro|author${peer}@example.com`,
    })),
  });

// The preview's mention menu reads Quick Access; nothing is mentionable here.
function useList(): QuickAccessList;
function useList<B extends Bucket>(
  bucket: B
): QuickAccessList<ItemForBucket<B>>;
function useList<B extends Bucket[]>(
  ...buckets: B
): QuickAccessList<ItemsForBuckets<B>>;
function useList<const B extends readonly Bucket[]>(
  options: QuickAccessListOptions<B>
): QuickAccessList<ItemForBucket<B[number]>>;
function useList(): QuickAccessList {
  return {
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    loadMore: async () => {},
  };
}
const quickAccess: QuickAccessContextValue = {
  useList,
  usesRecordSelection: () => false,
  usesSearchProjection: () => false,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
};

function Workspace() {
  const history = useHistory();
  onMount(() => history.open());
  return (
    <div class="flex h-screen min-h-0 bg-panel text-ink">
      <section
        aria-label="Version preview"
        class="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        <div class="mx-auto w-full max-w-3xl px-6 py-8">
          <HistoryOverlay
            currentState={() => latest}
            selectedAt={history.selectedAt()}
            isLive={history.isLive()}
          />
        </div>
      </section>
      <aside
        aria-label="History timeline and sessions"
        class="flex min-h-0 w-80 shrink-0 flex-col border-l border-edge-muted"
      >
        {history.loading.sessions() ? (
          <div role="status" class="p-4 text-xs text-ink-muted">
            Loading history…
          </div>
        ) : (
          <>
            <div class="shrink-0 border-b border-edge-muted p-4 pb-6">
              <HistoryScrubber compact />
            </div>
            <div class="min-h-0 flex-1 overflow-auto p-3">
              <h3 class="px-2 text-xs text-ink-muted">Sessions</h3>
              <HistorySessionList
                sessions={history.sessions()}
                selectedAt={history.selectedAt}
                onSelect={history.enter}
                onViewSessionDiff={history.diff.view}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing root');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={new QueryClient()}>
          <QuickAccessContextProvider value={quickAccess}>
            <UserContextProvider>
              <ChannelsContextProvider>
                <HistoryProvider documentId={() => 'history-fixture'}>
                  <Workspace />
                </HistoryProvider>
              </ChannelsContextProvider>
            </UserContextProvider>
          </QuickAccessContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
