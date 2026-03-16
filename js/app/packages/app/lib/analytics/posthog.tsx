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

const POSTHOG_KEY = 'phc_eSQcxAxPf0FAmnCTckz84305pNlMlOdDKciSKkuX0GO';

// Use proxy in production to avoid ad blockers, direct connection in development
const getPosthogHost = () => {
  if (import.meta.env.MODE === 'development') {
    return 'https://us.i.posthog.com';
  }
  return 'https://analytics-proxy.macroverse.workers.dev';
};

export const [PosthogProvider, usePosthog] = createAssertedContextProvider(
  'PosthogProvider',
  () => {
    const instance = new PostHog();

    const initialize = () => {
      instance.init(POSTHOG_KEY, {
        api_host: getPosthogHost(),
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
