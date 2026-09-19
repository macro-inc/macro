import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { RemoteFlag } from '@core/constant/featureFlags';
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
    // Distinguishes "flags not fetched yet" from "no flags enabled": both
    // leave featureFlags empty, but destructive flag-off fallbacks (e.g.
    // RedirectSplit) must not fire before the answer arrives. Set even on
    // errorsLoading so a PostHog outage degrades to flags-off, not a hang.
    const [flagsLoaded, setFlagsLoaded] = createSignal(false);

    const unsub = analytics.posthog.onFeatureFlags((flags, _, ctx) => {
      // Order matters: signals propagate synchronously, so flagsLoaded must
      // only flip after the flag values are in place — the other way around,
      // flag-off fallbacks fire against the still-empty flag list.
      if (!ctx?.errorsLoading) {
        setFeatureFlags(flags);
      }
      setFlagsLoaded(true);
    });

    onCleanup(unsub);

    return { instance: analytics.posthog, featureFlags, flagsLoaded };
  }
);

type FeatureFlagResult<T> = {
  enabled: boolean;
  payload: T;
  loading: boolean;
};

type FeatureFlagOpts<T> = {
  fallbackPayload?: T;
  enabledOverride?: boolean;
};

function readFeatureFlag<T extends JsonType>(
  flagOrKey: RemoteFlag | string,
  opts?: FeatureFlagOpts<T>
): Accessor<FeatureFlagResult<T | undefined>> {
  const posthog = usePosthog();

  return createMemo(
    () => {
      const fallbackPayload = opts?.fallbackPayload;
      const remote = typeof flagOrKey === 'string' ? undefined : flagOrKey;
      const key = typeof flagOrKey === 'string' ? flagOrKey : flagOrKey.key;
      const override = remote?.override ?? opts?.enabledOverride;

      if (override !== undefined) {
        return { enabled: override, payload: fallbackPayload, loading: false };
      }

      if (!posthog.flagsLoaded()) {
        return { enabled: false, payload: fallbackPayload, loading: true };
      }

      const result = posthog.instance.getFeatureFlagResult(key);

      return {
        enabled: result?.enabled ?? false,
        payload: (result?.payload as T) ?? fallbackPayload,
        loading: false,
      };
    },
    undefined,
    {
      equals: (prev, next) =>
        prev.enabled === next.enabled &&
        prev.payload === next.payload &&
        prev.loading === next.loading,
    }
  );
}

export function useFeatureFlag<T extends JsonType>(
  flag: RemoteFlag,
  opts?: { fallbackPayload?: T }
): Accessor<FeatureFlagResult<T | undefined>>;
export function useFeatureFlag<T extends JsonType>(
  key: string,
  opts?: FeatureFlagOpts<T>
): Accessor<FeatureFlagResult<T | undefined>>;
export function useFeatureFlag<T extends JsonType>(
  flagOrKey: RemoteFlag | string,
  opts?: FeatureFlagOpts<T>
): Accessor<FeatureFlagResult<T | undefined>> {
  return readFeatureFlag(flagOrKey, opts);
}

type ShowFeatureFlagProps<T> = {
  fallback?: JSX.Element;
  fallbackPayload?: T;
  children: JSX.Element;
} & ({ flag: RemoteFlag } | { key: string; enabledOverride?: boolean });

function showFlagTarget<T>(
  props: ShowFeatureFlagProps<T>
): RemoteFlag | string {
  if ('flag' in props) {
    return props.flag;
  }
  return props.key;
}

export const ShowFeatureFlag = <T extends JsonType>(
  props: ShowFeatureFlagProps<T>
) => {
  const flag = readFeatureFlag(showFlagTarget(props), {
    fallbackPayload: props.fallbackPayload,
    enabledOverride: 'flag' in props ? undefined : props.enabledOverride,
  });

  return (
    <Show when={flag().enabled} fallback={props.fallback}>
      {props.children}
    </Show>
  );
};
