import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { JsonType } from 'posthog-js';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';

export const [PosthogProvider, usePosthog] = createAssertedContextProvider(
  'PosthogProvider',
  () => {
    const analytics = useAnalytics();

    const [featureFlags, setFeatureFlags] = createSignal<string[]>([]);

    const unsub = analytics.posthog.onFeatureFlags((flags, _, ctx) => {
      if (ctx?.errorsLoading) return;

      setFeatureFlags(flags);
    });

    onCleanup(unsub);

    return { instance: analytics.posthog, featureFlags };
  }
);

type FeatureFlagResult<T> = { enabled: boolean; payload: T };

export function useFeatureFlag<T extends JsonType>(
  key: string,
  opts?: {
    fallbackPayload?: T;
    enabledOverride?: boolean;
  }
): Accessor<FeatureFlagResult<T | undefined>> {
  const posthog = usePosthog();

  return createMemo(
    () => {
      const { enabledOverride, fallbackPayload } = opts ?? {};

      if (!posthog.featureFlags().length && !enabledOverride) {
        return { enabled: false, payload: fallbackPayload };
      }

      const flag = posthog.instance.getFeatureFlagResult(key);

      // A defined override wins in both directions: an explicit `false`
      // disables even when PostHog reports the flag on.
      const enabled = enabledOverride ?? flag?.enabled ?? false;
      const payload = (flag?.payload as T) ?? fallbackPayload;

      return { enabled, payload };
    },
    undefined,
    {
      // Only notify dependents when enabled or payload actually changes
      equals: (prev, next) =>
        prev.enabled === next.enabled && prev.payload === next.payload,
    }
  );
}

export const ShowFeatureFlag = <T extends JsonType>(props: {
  key: string;
  fallback?: JSX.Element;
  fallbackPayload?: T;
  enabledOverride?: boolean;
  children: JSX.Element;
}) => {
  const flag = useFeatureFlag(props.key, {
    fallbackPayload: props.fallbackPayload,
    enabledOverride: props.enabledOverride,
  });

  return (
    <Show when={flag().enabled} fallback={props.fallback}>
      {props.children}
    </Show>
  );
};
