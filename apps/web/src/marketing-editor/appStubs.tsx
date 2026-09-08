/**
 * Inert stand-ins for the app contexts the editor tree asserts on.
 *
 * The editor is normally rendered inside the app shell, so several of its
 * dependencies are asserted contexts — they throw rather than returning
 * undefined when missing. This demo has no shell, no auth and no query client,
 * so each one is satisfied with the smallest value that keeps the editor
 * happy.
 *
 * The list here is empirical: it is exactly the set that threw while building
 * and loading the demo, nothing pre-emptive. If a future editor change reaches
 * for another context, the demo fails loudly at load with the context's name in
 * the message, which is the signal to add it here.
 */
import type { JSX } from 'solid-js';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { demoQuickAccessItems } from './mentionData';

/**
 * The @ menu's user search reaches a solid-query hook, which throws
 * "No QueryClient set" when mounted without a provider. That throw happens
 * inside MentionsMenu's <Suspense>, so it surfaces as the menu silently never
 * appearing — the @ trigger fires and inserts its node, and nothing opens.
 *
 * Retries are off and data never goes stale: the demo has no backend, so any
 * query that does slip through should fail once and stay quiet rather than
 * retrying on a timer for as long as the page is open.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
    mutations: { retry: false },
  },
});

/** An empty, non-loading QuickAccessList — the shape consumers destructure. */
const emptyList = () => ({
  items: () => [],
  totalCount: () => 0,
  hasMore: () => false,
  isLoading: () => false,
  isLoadingMore: () => false,
  loadMore: async () => {},
});

/**
 * Quick Access normally fronts the workspace search index. The @ menu here is
 * fed directly through `withMentions({ entities, users })`, which bypasses it,
 * so lists are empty on purpose — but `getById` still resolves against the
 * demo data, because mention pills look their subject up by id after insert
 * and would otherwise render blank.
 */
const quickAccessStub = {
  useList: emptyList,
  usesRecordSelection: () => false,
  usesSearchProjection: () => false,
  isLoading: () => false,
  refresh: () => {},
  getById: (id: string) => demoQuickAccessItems.find((item) => item.id === id),
  // Typed loosely on purpose: this is a runtime stand-in, and spelling out the
  // full overloaded QuickAccessContextValue here would couple the demo to a
  // type that changes for reasons that have nothing to do with it.
} as never;

/**
 * Wraps children in every context the editor asserts on. Kept in one place so
 * the real answer to "what does a standalone Macro editor depend on?" stays
 * readable at a glance.
 */
export function AppStubProviders(props: { children: JSX.Element }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <QuickAccessContextProvider value={quickAccessStub}>
          {props.children}
        </QuickAccessContextProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  );
}
