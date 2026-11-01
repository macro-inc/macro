/**
 * Whether a card applies: `true` or `false` once known, `undefined` while an
 * input (a feature flag, a query) is still loading.
 */
export type Verdict = boolean | undefined;

/** `false` as soon as any part is `false`, `true` once every part is `true`. */
export function allOf(...parts: Verdict[]): Verdict {
  if (parts.includes(false)) return false;
  if (parts.includes(undefined)) return undefined;
  return true;
}

/** A feature flag read: unknown until PostHog has answered. */
export function flagVerdict(flag: {
  enabled: boolean;
  loading: boolean;
}): Verdict {
  return flag.loading ? undefined : flag.enabled;
}
