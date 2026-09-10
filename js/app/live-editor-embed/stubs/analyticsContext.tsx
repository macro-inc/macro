// Stub for `@app/component/analytics-context`. The real one asserts a provider
// and pulls in the analytics singleton (PostHog/GA). The embed tracks nothing.
import type { JSX } from 'solid-js';

const deepNoop = (): any =>
  new Proxy(() => undefined, { get: () => deepNoop(), apply: () => undefined });

export function AnalyticsContextProvider(props: { children?: JSX.Element }) {
  return props.children;
}

export function useAnalytics(): any {
  return deepNoop();
}
