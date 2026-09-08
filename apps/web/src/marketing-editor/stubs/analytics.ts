/**
 * Stub for @app/lib/analytics/analytics, swapped in by the demo's Vite config.
 *
 * The real module ends with `export const analytics = createAnalytics()` — a
 * module-scope singleton that boots PostHog, Google Tag Manager and the Meta
 * pixel on import. Standing up the real AnalyticsContextProvider in the demo
 * therefore loaded connect.facebook.net, GTM-M58X7PJ8 and GA4 G-52HPEL3FTV
 * inside the marketing iframe, which already runs its own analytics: the demo
 * was double-counting pageviews and setting third-party cookies from a page
 * whose consent posture belongs to the marketing site, not the app.
 *
 * Stubbed at this module rather than at analytics-context, because the context
 * only re-exports this singleton and @core/util/upload reaches the singleton
 * directly. Killing it here covers every route to it.
 *
 * Every method is a no-op, and every feature flag reads as off: consumers spell
 * that `isFeatureEnabled(flag) ?? false`, so returning undefined gives the demo
 * the plain, un-flagged editor.
 */

export type AnalyticsProvider = 'ga' | 'meta-pixel' | 'posthog';
export type MetaStandardEvent = string;

function noop(): void {}

/**
 * Not just `track`: @core/constant/featureFlags is in the editor's import graph
 * and calls analytics.posthog.isFeatureEnabled directly, so the posthog handle
 * has to be present rather than undefined.
 */
const posthog = {
  isFeatureEnabled: (_flag: string): boolean | undefined => undefined,
  /** Real callers keep the return value as an unsubscribe. */
  onFeatureFlags: (_cb: unknown): (() => void) => noop,
  capture: noop,
  identify: noop,
  reset: noop,
  register: noop,
  setPersonProperties: noop,
  getFeatureFlag: (_flag: string): undefined => undefined,
};

export type AnalyticsInterface = {
  posthog: typeof posthog;
  track: (event: string, data?: Record<string, unknown>) => void;
  trackMeta: (
    event: MetaStandardEvent,
    data?: Record<string, unknown>,
    options?: { eventID?: string }
  ) => void;
  trackGoogleConversion: (
    action: string,
    data?: { value?: number; currency?: string; transaction_id?: string }
  ) => void;
  identify: (userID: string, info: Record<string, unknown>) => void;
  setPlanProperties: (licenseStatus: string | undefined) => void;
  reset: () => void;
  pageView: (pageTitle: string, opts?: unknown) => void;
};

export const analytics: AnalyticsInterface = {
  posthog,
  track: noop,
  trackMeta: noop,
  trackGoogleConversion: noop,
  identify: noop,
  setPlanProperties: noop,
  reset: noop,
  pageView: noop,
};
