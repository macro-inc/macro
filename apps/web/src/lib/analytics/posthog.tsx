import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { RemoteFlag } from '@core/constant/featureFlags';
import { createAssertedContextProvider } from '@core/context/createContext';
import { Telemetry } from '@macro-inc/observability';
import type { JsonType, PostHog } from 'posthog-js';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  startTransition,
} from 'solid-js';
import { flagStore } from './flag-store';

export const [PosthogProvider, usePosthog] = createAssertedContextProvider(
  'PosthogProvider',
  () => {
    const analytics = useAnalytics();

    // PostHog only reports flags once `/flags` answers, but it already serves
    // the flags it cached on the previous visit. Starting from that cache means
    // returning users paint flagged UI once, not flags-off first and then again
    // when the answer lands (e.g. soup lists reloading on a transport swap).
    const cachedFlags = analytics.posthog.featureFlags?.getFlags() ?? [];
    const [featureFlags, setFeatureFlags] = createSignal<string[]>(
      cachedFlags,
      { equals: false }
    );
    const disconnect = flagStore.connect(analytics.posthog);

    const unsub = analytics.posthog.onFeatureFlags((flags, _, ctx) => {
      // Flags usually arrive after first paint and swap flagged subtrees,
      // often to lazy views. A transition keeps the painted UI until the new
      // one is ready instead of flashing Suspense fallbacks in between.
      startTransition(() => {
        // Order matters: signals propagate synchronously, so the store must
        // settle only after the flag values are in place — the other way
        // around, flag-off fallbacks fire against the still-empty flag list.
        if (!ctx?.errorsLoading) {
          setFeatureFlags(flags);
        }
        flagStore.receiveRemote(ctx?.errorsLoading === true);
      }).catch((error) => Telemetry.error(error, { surface: 'feature-flags' }));
    });

    onCleanup(() => {
      unsub();
      disconnect();
    });

    return {
      instance: analytics.posthog,
      featureFlags,
      // Distinguishes "flags not known yet" from "no flags enabled", so
      // destructive flag-off fallbacks (e.g. RedirectSplit) wait for an answer
      // from PostHog, the backend, or a cache. Settles when PostHog fails and
      // no backend read is pending, so an outage degrades to flags-off, not a
      // hang.
      flagsLoaded: flagStore.settled,
      // Whether the last fetch got no answer at all (blocked, offline, PostHog
      // down), as opposed to an answer that says a flag is off.
      flagsUnreachable: flagStore.unreachable,
    };
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
  /**
   * Treat the flag as on when PostHog could not be reached and holds no
   * earlier answer for it; an answer of "off" still wins. For pages anonymous
   * visitors depend on, which a blocked flag request must not take down.
   */
  enabledWhenUnreachable?: boolean;
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

      let result: ReturnType<PostHog['getFeatureFlagResult']> | undefined;
      const resolved = flagStore.resolve(key, () => {
        result = posthog.instance.getFeatureFlagResult(key);
        return result?.enabled;
      });
      const unreachableDefault =
        opts?.enabledWhenUnreachable === true && posthog.flagsUnreachable();
      // Payloads only come from PostHog; backend flags carry none.
      const payload =
        resolved?.source === 'remote' || resolved?.source === 'cache'
          ? (result?.payload as T | undefined)
          : undefined;

      return {
        enabled: resolved?.enabled ?? unreachableDefault,
        payload: payload ?? fallbackPayload,
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
  opts?: Pick<FeatureFlagOpts<T>, 'fallbackPayload' | 'enabledWhenUnreachable'>
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
