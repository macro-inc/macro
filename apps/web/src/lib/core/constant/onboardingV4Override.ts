/**
 * Default for `ENABLE_ONBOARDING_V4_OVERRIDE` when `VITE_ENABLE_ONBOARDING_V4`
 * is unset. Local vite (`import.meta.hot`) is off so signing in does not dump
 * you into the stepper — set `VITE_ENABLE_ONBOARDING_V4=true` to work on the
 * flow. Hosted development (`dev.macro.com`) stays on; production defers to
 * PostHog (`undefined`).
 */
export function defaultOnboardingV4Override(
  localOnly: boolean,
  devMode: boolean
): boolean | undefined {
  if (localOnly) {
    return false;
  }
  if (devMode) {
    return true;
  }
  return undefined;
}
