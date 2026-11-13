import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { RemoteFlag } from '@core/constant/featureFlags';
import { Telemetry } from '@macro-inc/observability';
import { createContextProvider } from '@solid-primitives/context';
import type { JsonType } from 'posthog-js';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  startTransition,
} from 'solid-js';

const [PosthogProvider, useOptionalPosthog] = createContextProvider(() => {
  const analytics = useAnalytics();

  // PostHog only reports flags once `/flags` answers, but it already serves
  // the flags it cached on the previous visit. Starting from that cache means
  // returning users paint flagged UI once, not flags-off first and then again
  // when the answer lands (e.g. soup lists reloading on a transport swap).
  const cachedFlags = analytics.posthog.featureFlags?.getFlags() ?? [];
  const [featureFlags, setFeatureFlags] = createSignal<string[]>(cachedFlags, {
    equals: false,
  });
  // Distinguishes "flags not fetched yet" from "no flags enabled": both
  // leave featureFlags empty, but destructive flag-off fallbacks (e.g.
  // RedirectSplit) must not fire before the answer arrives. Set even on
  // errorsLoading so a PostHog outage degrades to flags-off, not a hang.
  const [flagsLoaded, setFlagsLoaded] = createSignal(cachedFlags.length > 0);
  // Whether the last fetch got no answer at all (blocked, offline, PostHog
  // down), as opposed to an answer that says a flag is off.
  const [flagsUnreachable, setFlagsUnreachable] = createSignal(false);

  const unsub = analytics.posthog.onFeatureFlags((flags, _, ctx) => {
    // Flags usually arrive after first paint and swap flagged subtrees,
    // often to lazy views. A transition keeps the painted UI until the new
    // one is ready instead of flashing Suspense fallbacks in between.
    startTransition(() => {
      // Order matters: signals propagate synchronously, so flagsLoaded must
      // only flip after the flag values are in place — the other way around,
      // flag-off fallbacks fire against the still-empty flag list.
      if (!ctx?.errorsLoading) {
        setFeatureFlags(flags);
      }
      setFlagsUnreachable(ctx?.errorsLoading === true);
      setFlagsLoaded(true);
    }).catch((error) => Telemetry.error(error, { surface: 'feature-flags' }));
  });

  onCleanup(unsub);

  return {
    instance: analytics.posthog,
    featureFlags,
    flagsLoaded,
    flagsUnreachable,
  };
});

export { PosthogProvider };

export function usePosthog() {
  const posthog = useOptionalPosthog();
  if (posthog === undefined) {
    throw new Error('PosthogProvider must be used within <PosthogProvider />');
  }
  return posthog;
}

/**
 * Whether a flag is on, tracked so callers update when PostHog answers after
 * first paint; undefined outside a `PosthogProvider` (fixtures, pages without
 * the app's providers), where callers fall back to `isFeatureEnabled`.
 */
export function useOptionalFlagEnabled(
  flag: RemoteFlag
): Accessor<boolean> | undefined {
  const posthog = useOptionalPosthog();
  if (posthog === undefined) return undefined;
  // A memo, so a flags refresh that leaves this flag unchanged does not
  // re-run every reader (each avatar and sender name in a channel).
  return createMemo(() => {
    if (flag.override !== undefined) return flag.override;
    // The SDK is not reactive; this read re-runs on each flags refresh.
    posthog.featureFlags();
    return posthog.instance.isFeatureEnabled(flag.key) ?? false;
  });
}

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

      // The SDK is not reactive. Re-read on each successful refresh, including
      // payload changes that leave the enabled flag list unchanged.
      posthog.featureFlags();
      const result = posthog.instance.getFeatureFlagResult(key);
      const unreachableDefault =
        opts?.enabledWhenUnreachable === true && posthog.flagsUnreachable();

      return {
        enabled: result?.enabled ?? unreachableDefault,
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
