/** PostHog feature flag used to configure the connector steps in onboarding. */
export const ONBOARDING_CONNECTORS_FEATURE_FLAG = 'onboarding-v4-connectors';

export const ONBOARDING_CONNECTORS = [
  { key: 'linear', serverName: 'Linear' },
  { key: 'notion', serverName: 'Notion' },
  { key: 'slack', serverName: 'Slack' },
  { key: 'github', serverName: 'GitHub' },
] as const;

export type OnboardingConnectorServerName =
  (typeof ONBOARDING_CONNECTORS)[number]['serverName'];

/**
 * Resolves the connector steps from the PostHog flag payload.
 *
 * The supported payload is a JSON object with connector keys and boolean
 * values, for example:
 *
 * `{ "linear": true, "notion": true, "slack": false, "github": true }`
 *
 * Existing behavior is fail-open: the flag must be enabled and a connector
 * must be explicitly set to `false` to hide it.
 */
export function resolveOnboardingConnectorNames(
  flagEnabled: boolean,
  payload: unknown
): OnboardingConnectorServerName[] {
  if (!flagEnabled || !isObject(payload)) {
    return ONBOARDING_CONNECTORS.map(({ serverName }) => serverName);
  }

  return ONBOARDING_CONNECTORS.filter(({ key }) => payload[key] !== false).map(
    ({ serverName }) => serverName
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
