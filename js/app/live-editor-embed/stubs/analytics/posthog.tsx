// Stub for `@app/lib/analytics/posthog`. Feature flags resolve to their default.
import type { JSX } from 'solid-js';

const deepNoop = (): any =>
  new Proxy(() => undefined, { get: () => deepNoop(), apply: () => undefined });

export function PosthogProvider(props: { children?: JSX.Element }) {
  return props.children;
}

export function usePosthog(): any {
  return deepNoop();
}

export function useFeatureFlag<T = unknown>(_flag: unknown, defaultValue?: T) {
  return () => defaultValue;
}

export function ShowFeatureFlag(_props: any): any {
  return null;
}
