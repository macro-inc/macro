export {};

const result = document.querySelector<HTMLElement>('#result');
if (!result) throw new Error('missing Cache GraphQL Soup result node');

const NativeWorker = globalThis.Worker;
const NativeSharedWorker = globalThis.SharedWorker;
const workerUrls: string[] = [];
const sharedWorkerUrls: string[] = [];

globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, args: ConstructorParameters<typeof Worker>) {
    workerUrls.push(String(args[0]));
    return Reflect.construct(target, args) as Worker;
  },
});
globalThis.SharedWorker = new Proxy(NativeSharedWorker, {
  construct(target, args: ConstructorParameters<typeof SharedWorker>) {
    sharedWorkerUrls.push(String(args[0]));
    return Reflect.construct(target, args) as SharedWorker;
  },
});

const resources = () => ({
  workerUrls: [...workerUrls],
  sharedWorkerUrls: [...sharedWorkerUrls],
});

const loadSoup = async () =>
  await import('../../../service-clients/service-storage/graphql-soup');

let posthogBeforeSendCalls = 0;

async function initializeLocalPosthog() {
  const { analytics } = await import('@app/lib/analytics');
  if (!analytics.posthog.config.token) {
    const disabledApiHost = `${location.origin}/__cache-rollout-posthog-disabled`;
    analytics.posthog.init('phc_cache_rollout_local_test', {
      api_host: disabledApiHost,
      flags_api_host: disabledApiHost,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      enable_recording_console_log: false,
      disable_persistence: true,
      persistence: 'memory',
      disable_external_dependency_loading: true,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      advanced_disable_flags: true,
      advanced_disable_feature_flags_on_first_load: true,
      advanced_disable_toolbar_metrics: true,
      request_batching: false,
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      person_profiles: 'never',
      save_campaign_params: false,
      save_referrer: false,
      before_send: () => {
        posthogBeforeSendCalls += 1;
        return null;
      },
      loaded: (posthog) => posthog.opt_out_capturing(),
    });
  }
  return analytics;
}

function overrideRolloutFlags(
  analytics: Awaited<ReturnType<typeof initializeLocalPosthog>>,
  disabled: boolean
): void {
  analytics.posthog.featureFlags.overrideFeatureFlags({
    flags: {
      'enable-graphql-soup': true,
      'disable-browser-turso-cache': disabled,
    },
    suppressWarning: true,
  });
}

const api = {
  resources,
  async resolveDefaultOff(): Promise<{
    cacheEnabled: boolean;
    cacheHostPresent: boolean;
    resources: ReturnType<typeof resources>;
  }> {
    const soup = await loadSoup();
    soup.getGraphqlSoupClient();
    return {
      cacheEnabled: soup.graphqlCacheEnabled(),
      cacheHostPresent: soup.getGraphqlCacheHost() !== undefined,
      resources: resources(),
    };
  },
  async tryTreatment(): Promise<
    | {
        overrideApplied: false;
        blocker: 'posthog-override-unavailable';
        posthogBeforeSendCalls: number;
        resources: ReturnType<typeof resources>;
      }
    | {
        overrideApplied: true;
        lazyBeforeRead: boolean;
        readKind: string;
        samePageKillLatched: boolean;
        posthogBeforeSendCalls: number;
        resources: ReturnType<typeof resources>;
      }
  > {
    const analytics = await initializeLocalPosthog();
    overrideRolloutFlags(analytics, false);
    const overrideApplied =
      analytics.posthog.isFeatureEnabled('enable-graphql-soup') === true &&
      analytics.posthog.isFeatureEnabled('disable-browser-turso-cache') ===
        false;
    if (!overrideApplied) {
      return {
        overrideApplied: false,
        blocker: 'posthog-override-unavailable',
        posthogBeforeSendCalls,
        resources: resources(),
      };
    }

    const soup = await loadSoup();
    const client = soup.getGraphqlSoupClient();
    const host = soup.getGraphqlCacheHost();
    if (!host) throw new Error('PostHog treatment did not create cache host');
    const lazyBeforeRead =
      workerUrls.length === 0 && sharedWorkerUrls.length === 0;
    const read = await host.readQuery({
      query: 'query CacheRolloutSelector { __typename }',
      operationName: 'CacheRolloutSelector',
    });

    overrideRolloutFlags(analytics, true);
    const samePageKillLatched =
      soup.getGraphqlSoupClient() === client &&
      soup.getGraphqlCacheHost() === host;
    return {
      overrideApplied: true,
      lazyBeforeRead,
      readKind: read.kind,
      samePageKillLatched,
      posthogBeforeSendCalls,
      resources: resources(),
    };
  },
  async resolveAfterNavigationKill(): Promise<{
    cacheEnabled: boolean;
    cacheHostPresent: boolean;
    posthogBeforeSendCalls: number;
    resources: ReturnType<typeof resources>;
  }> {
    const analytics = await initializeLocalPosthog();
    overrideRolloutFlags(analytics, true);
    const soup = await loadSoup();
    soup.getGraphqlSoupClient();
    return {
      cacheEnabled: soup.graphqlCacheEnabled(),
      cacheHostPresent: soup.getGraphqlCacheHost() !== undefined,
      posthogBeforeSendCalls,
      resources: resources(),
    };
  },
};

declare global {
  interface Window {
    graphqlSoupRolloutHarness: typeof api;
  }
}

window.graphqlSoupRolloutHarness = api;
result.dataset.status = 'ready';
result.textContent = JSON.stringify({ actualGraphqlSoupPath: true });
