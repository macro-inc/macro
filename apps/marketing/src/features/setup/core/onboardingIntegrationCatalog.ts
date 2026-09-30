import type { OnboardingIntegration } from './onboardingIntegrations';

/** These connectors have bespoke import or repository-linking flows. */
const NATIVE_INTEGRATION_IDS = new Set(['linear', 'slack', 'notion', 'github']);

/** Email and Calendar are handled earlier; Sheets is deliberately omitted from onboarding. */
const EXCLUDED_INTEGRATION_IDS = [
  'google_sheets',
  'google_calendar',
  'gmail',
  'microsoft_outlook',
];

export function onboardingIntegrationKind(id: string): 'Native' | 'MCP' {
  return NATIVE_INTEGRATION_IDS.has(id) ? 'Native' : 'MCP';
}

export function onboardingIntegrationAvailable(id: string): boolean {
  const slug = id.toLowerCase().replaceAll('-', '_');
  return !EXCLUDED_INTEGRATION_IDS.some(
    (excluded) => slug === excluded || slug.startsWith(`${excluded}_`)
  );
}

/** Keep our presets first, deduplicate directory results, and search both. */
export function onboardingIntegrationEntries(
  featured: readonly OnboardingIntegration[],
  catalog: readonly OnboardingIntegration[],
  hidden: ReadonlySet<string>,
  search: string
): OnboardingIntegration[] {
  const native = featured.filter(
    (entry) => onboardingIntegrationKind(entry.id) === 'Native'
  );
  const mcp = featured.filter(
    (entry) => onboardingIntegrationKind(entry.id) === 'MCP'
  );
  const seen = new Set<string>();
  const term = search.trim().toLowerCase();
  return [...native, ...mcp, ...catalog].filter((entry) => {
    // Pipedream uses slack_v2 for the same Slack connection offered natively.
    const identity = entry.id === 'slack_v2' ? 'slack' : entry.id;
    if (
      seen.has(identity) ||
      hidden.has(identity) ||
      !onboardingIntegrationAvailable(entry.id)
    )
      return false;
    seen.add(identity);
    return `${entry.name} ${entry.id.replaceAll('_', ' ')}`
      .toLowerCase()
      .includes(term);
  });
}
