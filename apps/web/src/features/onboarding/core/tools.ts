/** These apps are handled outside the onboarding tools catalog. */
export const ONBOARDING_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'gmail',
  'google_calendar',
]);

/** Exact directory slugs and display names, in our preferred browse order. */
export const ONBOARDING_PRIORITY_TOOLS = [
  ['linear', 'Linear'],
  ['notion', 'Notion'],
  ['slack', 'Slack'],
  // Common startup workflows.
  ['posthog', 'PostHog'],
  ['stripe', 'Stripe'],
  ['github', 'GitHub'],
  ['figma', 'Figma'],
  ['intercom', 'Intercom'],
  ['hubspot', 'HubSpot'],
  ['airtable_oauth', 'Airtable'],
  // Small-business operations.
  ['quickbooks', 'QuickBooks'],
  ['xero_accounting_api', 'Xero'],
  ['shopify', 'Shopify'],
  ['mailchimp', 'Mailchimp'],
  ['zendesk', 'Zendesk'],
  ['calendly_v2', 'Calendly'],
  ['asana', 'Asana'],
  ['trello', 'Trello'],
] as const;

/** Macro owns GitHub account linking; this entry does not depend on Pipedream. */
export const NATIVE_GITHUB_TOOL = {
  slug: 'github',
  name: 'GitHub',
  iconUrl: null,
};

/** Pipedream directory metadata verified against the production catalog 2026-10-12.
 * Refresh when changing featured apps; normal browse/search metadata remains live. */
const FEATURED_ICONS: Readonly<Record<string, string>> = {
  posthog: 'https://assets.pipedream.net/s.v0/app_mo7h7A/logo/orig',
  notion: 'https://assets.pipedream.net/s.v0/app_X7Lhxr/logo/orig',
  linear: 'https://assets.pipedream.net/s.v0/app_X7Lh0L/logo/orig',
  stripe: 'https://assets.pipedream.net/s.v0/app_OD5hrX/logo/orig',
  slack: 'https://assets.pipedream.net/s.v0/app_M0hv7G/logo/orig',
  intercom: 'https://assets.pipedream.net/s.v0/app_1pbh0B/logo/orig',
  figma: 'https://assets.pipedream.net/s.v0/app_OkrhRR/logo/orig',
  hubspot: 'https://assets.pipedream.net/s.v0/app_OkrhlP/logo/orig',
  mailchimp: 'https://assets.pipedream.net/s.v0/app_mE7h2q/logo/orig',
  shopify: 'https://assets.pipedream.net/s.v0/app_X7Lhpm/logo/orig',
  airtable_oauth: 'https://assets.pipedream.net/s.v0/app_XBxhAl/logo/orig',
  xero_accounting_api: 'https://assets.pipedream.net/s.v0/app_1dBh9j/logo/orig',
  zendesk: 'https://assets.pipedream.net/s.v0/app_1pbhGX/logo/orig',
  asana: 'https://assets.pipedream.net/s.v0/app_OVWhPX/logo/orig',
  calendly_v2: 'https://assets.pipedream.net/s.v0/app_Oz6h0D/logo/orig',
  quickbooks: 'https://assets.pipedream.net/s.v0/app_m02hWG/logo/orig',
  trello: 'https://assets.pipedream.net/s.v0/app_168hnX/logo/orig',
};
export const ONBOARDING_FEATURED_TOOLS = ONBOARDING_PRIORITY_TOOLS.map(
  ([slug, name]) => ({
    slug,
    name,
    iconUrl: FEATURED_ICONS[slug] ?? null,
  })
);
