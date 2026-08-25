import { useFeatureFlag, usePosthog } from '@app/lib/analytics/posthog';
import {
  ENABLE_ONBOARDING_V4_FLAG,
  ENABLE_ONBOARDING_V4_OVERRIDE,
} from '@core/constant/featureFlags';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/**
 * How long to treat "PostHog hasn't answered yet" as loading before falling
 * back to the flag's default (off). Without this a blocked or failing PostHog
 * would leave onboarding gates spinning forever.
 */
const FLAG_WAIT_MS = 3_000;

/** Reactive result of the onboarding-v4 gate. */
export type OnboardingV4Flag = {
  /** Whether onboarding v4 is on for this user. */
  enabled: boolean;
  /**
   * PostHog hasn't reported flags yet. Call sites that would navigate away
   * should wait on this rather than reading `enabled: false` as "off".
   */
  loading: boolean;
};

/**
 * Gate for onboarding v4, controlled by the `enable-onboarding-v4` PostHog
 * flag and overridable locally with `VITE_ENABLE_ONBOARDING_V4`.
 * `just run_local` sets that env to false unless `--enable-onboarding`.
 */
export function useOnboardingV4Flag(): Accessor<OnboardingV4Flag> {
  const posthog = usePosthog();
  const flag = useFeatureFlag(ENABLE_ONBOARDING_V4_FLAG, {
    enabledOverride: ENABLE_ONBOARDING_V4_OVERRIDE,
  });

  const [waited, setWaited] = createSignal(false);
  const timer = setTimeout(() => setWaited(true), FLAG_WAIT_MS);
  onCleanup(() => clearTimeout(timer));

  return () => ({
    enabled: flag().enabled,
    loading:
      ENABLE_ONBOARDING_V4_OVERRIDE === undefined &&
      !posthog.featureFlags().length &&
      !waited(),
  });
}
