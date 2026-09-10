// Stub for `@app/lib/analytics/analytics`.
export type AnalyticsProvider = 'ga' | 'meta-pixel' | 'posthog';
export type AnalyticsInterface = any;

const deepNoop = (): any =>
  new Proxy(() => undefined, { get: () => deepNoop(), apply: () => undefined });

export const analytics: any = deepNoop();
export function createAnalytics(): any {
  return deepNoop();
}
