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

/** Mail from these domains suggests the person already uses the tool. */
const TOOL_SENDER_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  linear: ['linear.app'],
  notion: ['notion.so', 'makenotion.com'],
  slack: ['slack.com'],
  posthog: ['posthog.com'],
  stripe: ['stripe.com'],
  github: ['github.com'],
  figma: ['figma.com'],
  intercom: ['intercom.io', 'intercom.com'],
  hubspot: ['hubspot.com'],
  airtable_oauth: ['airtable.com'],
  quickbooks: ['intuit.com'],
  xero_accounting_api: ['xero.com'],
  shopify: ['shopify.com'],
  mailchimp: ['mailchimp.com'],
  zendesk: ['zendesk.com'],
  calendly_v2: ['calendly.com'],
  asana: ['asana.com'],
  trello: ['trello.com'],
};

/**
 * What connecting the tool does in Macro: Macro's own import (Settings →
 * Integrations and the import catalog), then what agents can do with it.
 */
const TOOL_REASONS: Readonly<Record<string, string>> = {
  linear:
    'Import Linear issues into Macro tasks, and let agents create and update issues.',
  notion:
    'Import pages and wikis into your Macro Drive, and let agents search them.',
  slack:
    'Import channels into Macro, and let agents search conversations and post updates.',
  github:
    'Review pull requests in Macro, import issues into tasks, and give agents repository access.',
  asana:
    'Import tasks into Macro tasks, and let agents create and update them.',
  trello: 'Import cards into Macro tasks, and let agents update your boards.',
  hubspot:
    'Import companies and contacts into the Macro CRM, and let agents work with your deals.',
  airtable_oauth:
    'Import records into the Macro CRM, and let agents read and update your bases.',
  posthog:
    'Let agents answer questions about product usage, funnels and trends.',
  stripe: 'Let agents look up customers, payments and subscriptions.',
  figma: 'Let agents read your designs and their comments.',
  intercom: 'Let agents look up customer conversations and contacts.',
  quickbooks: 'Let agents look up invoices, bills and payments.',
  xero_accounting_api: 'Let agents look up invoices, bills and payments.',
  shopify: 'Let agents look up orders, products and customers.',
  mailchimp: 'Let agents check your campaigns and audiences.',
  zendesk: 'Let agents look up and update support tickets.',
  calendly_v2: 'Let agents look up your bookings and event types.',
};

/** Built into Macro, as Settings → Integrations labels it; the rest are MCP. */
const NATIVE_TOOLS: ReadonlySet<string> = new Set(['github']);

/** Every sender domain the inbox check asks the mail provider about. */
export const ONBOARDING_SENDER_DOMAINS: readonly string[] =
  Object.values(TOOL_SENDER_DOMAINS).flat();

/** Suggested when the inbox shows too little, in this order. */
const DEFAULT_SUGGESTED_TOOLS = ['slack', 'linear', 'notion', 'github'];

/** Tool rows shown above the catalog; "Add another inbox" is always added. */
export const SUGGESTED_TOOL_LIMIT = 4;

export type SuggestedTool = {
  tool: { slug: string; name: string; iconUrl: string | null };
  /** How it reaches Macro: built in, or as tools agents call over MCP. */
  kind: 'native' | 'mcp';
  reason: string;
  /** Recent messages from the tool; 0 when it is a default pick. */
  messageCount: number;
};

/**
 * The tools the inbox shows the person already uses, most mail first, topped
 * up with defaults. `counts` maps sender domain to recent message count.
 */
export function rankSuggestedTools(
  counts: Readonly<Record<string, number>>
): SuggestedTool[] {
  const suggestions = ONBOARDING_FEATURED_TOOLS.map((tool) => ({
    tool,
    kind: NATIVE_TOOLS.has(tool.slug) ? ('native' as const) : ('mcp' as const),
    reason: TOOL_REASONS[tool.slug] ?? '',
    messageCount: (TOOL_SENDER_DOMAINS[tool.slug] ?? []).reduce(
      (sum, domain) => sum + (counts[domain] ?? 0),
      0
    ),
  }));
  const used = suggestions
    .filter((suggestion) => suggestion.messageCount > 0)
    .sort((a, b) => b.messageCount - a.messageCount);
  const defaults = DEFAULT_SUGGESTED_TOOLS.flatMap(
    (slug) =>
      suggestions.find(
        (suggestion) =>
          suggestion.tool.slug === slug && !used.includes(suggestion)
      ) ?? []
  );
  return [...used, ...defaults].slice(0, SUGGESTED_TOOL_LIMIT);
}
