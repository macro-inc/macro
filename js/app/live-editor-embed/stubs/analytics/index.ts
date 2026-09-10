// Stub for the `@app/lib/analytics` barrel. Reached via `@core/util/upload`,
// `featureFlags`, etc. A deep no-op proxy satisfies any `analytics.x.y()` chain
// (e.g. `analytics.posthog.isFeatureEnabled(...)`).
export type AnalyticsProvider = 'ga' | 'meta-pixel' | 'posthog';

const deepNoop = (): any =>
  new Proxy(() => undefined, { get: () => deepNoop(), apply: () => undefined });

export const analytics: any = deepNoop();
