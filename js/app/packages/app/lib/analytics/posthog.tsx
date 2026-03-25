import { useAnalytics } from '@app/component/analytics-context';
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

  return createMemo(() => {
    const { enabledOverride, fallbackPayload } = opts ?? {};

    if (!posthog.featureFlags().length && !enabledOverride) {
      return { enabled: false, payload: fallbackPayload };
    }

    const flag = posthog.instance.getFeatureFlagResult(key);

    const enabled = flag?.enabled || (enabledOverride ?? false);
    const payload = (flag?.payload as T) ?? fallbackPayload;

    return { enabled, payload };
  });
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
