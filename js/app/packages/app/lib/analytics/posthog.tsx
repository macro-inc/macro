import { createAssertedContextProvider } from '@core/context/createContext';
import { PostHog, type JsonType } from 'posthog-js';
import {
  type Accessor,
  children,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';

export const posthogInstance = new PostHog();

export const [PosthogProvider, usePosthog] = createAssertedContextProvider(
  'PosthogProvider',
  () => {
    const instance = posthogInstance;

    const initialize = () => {
      const key = import.meta.env.VITE_POSTHOG_API_KEY;

      if (!key) return;

      instance.init(key, {
        api_host: 'https://us.i.posthog.com',
        ui_host: 'https://us.posthog.com', // Keep UI host for session recordings link
        defaults: '2026-01-30',
      });
    };

    if (!import.meta.env.DEV) {
      initialize();
    }

    const [featureFlags, setFeatureFlags] = createSignal<string[]>([]);

    const unsub = instance.onFeatureFlags((flags, _, ctx) => {
      if (ctx?.errorsLoading) return;

      setFeatureFlags(flags);
    });

    onCleanup(unsub);

    return { instance, featureFlags };
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

    const enabled = flag?.enabled || enabledOverride || false;
    const payload = (flag?.payload as T) ?? fallbackPayload;

    return { enabled, payload };
  });
}

export const ShowFeatureFlag = <T extends JsonType>(props: {
  key: string;
  fallback?: JSX.Element;
  fallbackPayload?: T;
  enabledOverride?: boolean;
  children: JSX.Element | ((payload: T | undefined) => JSX.Element);
}) => {
  const flag = useFeatureFlag(props.key, {
    fallbackPayload: props.fallbackPayload,
    enabledOverride: props.enabledOverride,
  });

  const resolved = children(() => {
    const children_ = props.children;

    if (typeof children_ === 'function') {
      return children_(flag().payload);
    }

    return children_;
  });

  return (
    <Show when={flag().enabled} fallback={props.fallback}>
      {resolved()}
    </Show>
  );
};
