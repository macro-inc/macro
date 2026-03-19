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

export const [PosthogProvider, usePosthog] = createAssertedContextProvider(
  'PosthogProvider',
  () => {
    const instance = new PostHog();

    const initialize = () => {
      const key = import.meta.env.VITE_POSTHOG_KEY;

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
  key: string
): Accessor<FeatureFlagResult<T | undefined>>;
export function useFeatureFlag<T extends JsonType>(
  key: string,
  fallbackPayload: T
): Accessor<FeatureFlagResult<T>>;
export function useFeatureFlag<T extends JsonType>(
  key: string,
  fallbackPayload?: T
): Accessor<FeatureFlagResult<T | undefined>> {
  const posthog = usePosthog();

  return createMemo(() => {
    if (!posthog.featureFlags().length)
      return { enabled: false, payload: fallbackPayload };

    const flag = posthog.instance.getFeatureFlagResult(key);

    if (!flag?.enabled) return { enabled: false, payload: fallbackPayload };

    return { enabled: true, payload: (flag.payload as T) ?? fallbackPayload };
  });
}

export const ShowFeatureFlag = <T extends JsonType>(props: {
  key: string;
  fallback?: JSX.Element;
  fallbackPayload?: T;
  children: JSX.Element | ((payload: NonNullable<T>) => JSX.Element);
}) => {
  const flag = useFeatureFlag(props.key, props.fallbackPayload);

  return (
    <Show when={flag().enabled && flag().payload} fallback={props.fallback}>
      {(payload) => {
        const resolved = children(() => {
          const children_ = props.children;

          if (typeof children_ === 'function') {
            return children_(payload());
          }

          return children_;
        });

        return <>{resolved()}</>;
      }}
    </Show>
  );
};
