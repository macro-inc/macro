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

/** What a business runs on, so each suggestion covers a different job. */
type ToolCategory =
  | 'crm'
  | 'ecommerce'
  | 'payments'
  | 'accounting'
  | 'support'
  | 'chat'
  | 'tasks'
  | 'docs'
  | 'databases'
  | 'code'
  | 'design'
  | 'analytics'
  | 'marketing'
  | 'scheduling';

/** A tool onboarding can suggest from the person's inbox. */
type RecommendableTool = {
  slug: string;
  name: string;
  iconUrl: string | null;
  category: ToolCategory;
  /** Mail from these domains suggests the business uses the tool. */
  senderDomains: readonly string[];
  /** What connecting it does in Macro: its import, then what agents can do. */
  reason: string;
};

/**
 * Suggestable tools, in the order their domains are searched: a search cut
 * short by the provider reaches the CRM and store first. Pipedream logos for
 * tools outside the featured list were verified on 2026-11-05.
 */
const RECOMMENDABLE_TOOLS: readonly RecommendableTool[] = [
  {
    slug: 'hubspot',
    name: 'HubSpot',
    iconUrl: FEATURED_ICONS.hubspot,
    category: 'crm',
    senderDomains: ['hubspot.com'],
    reason:
      'Import companies and contacts into the Macro CRM, and let agents work with the deals in your HubSpot account.',
  },
  {
    slug: 'salesforce_rest_api',
    name: 'Salesforce',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_OrZhD7/logo/orig',
    category: 'crm',
    senderDomains: ['salesforce.com'],
    reason:
      'Import accounts and contacts into the Macro CRM, and let agents look up and update Salesforce records.',
  },
  {
    slug: 'pipedrive',
    name: 'Pipedrive',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_1lxhdk/logo/orig',
    category: 'crm',
    senderDomains: ['pipedrive.com'],
    reason:
      'Let agents look up deals, people and organizations in Pipedrive, and keep your pipeline up to date.',
  },
  {
    slug: 'close',
    name: 'Close',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_1lxhEz/logo/orig',
    category: 'crm',
    senderDomains: ['close.com'],
    reason:
      'Import leads and contacts into the Macro CRM, and let agents look up and update them in Close for you.',
  },
  {
    slug: 'attio',
    name: 'Attio',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_w0hvd3/logo/orig',
    category: 'crm',
    senderDomains: ['attio.com'],
    reason:
      'Let agents look up and update the people, companies and deals in your Attio workspace on your behalf.',
  },
  {
    slug: 'shopify',
    name: 'Shopify',
    iconUrl: FEATURED_ICONS.shopify,
    category: 'ecommerce',
    senderDomains: ['shopify.com'],
    reason:
      'Let agents look up orders, products and customers in your Shopify store from anywhere in Macro.',
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    iconUrl: FEATURED_ICONS.stripe,
    category: 'payments',
    senderDomains: ['stripe.com'],
    reason:
      'Let agents look up your customers, payments and subscriptions in Stripe without leaving Macro.',
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    iconUrl: FEATURED_ICONS.quickbooks,
    category: 'accounting',
    senderDomains: ['intuit.com'],
    reason:
      'Let agents look up invoices, bills and payments in QuickBooks and answer questions about them.',
  },
  {
    slug: 'xero_accounting_api',
    name: 'Xero',
    iconUrl: FEATURED_ICONS.xero_accounting_api,
    category: 'accounting',
    senderDomains: ['xero.com'],
    reason:
      'Let agents look up invoices, bills and payments in Xero, and answer your questions about them in chat.',
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    iconUrl: FEATURED_ICONS.intercom,
    category: 'support',
    senderDomains: ['intercom.io'],
    reason:
      'Let agents look up customer conversations and contacts in Intercom, right next to the rest of your inbox.',
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    iconUrl: FEATURED_ICONS.zendesk,
    category: 'support',
    senderDomains: ['zendesk.com'],
    reason:
      "Let agents look up and update Zendesk support tickets, right next to the customer's own email thread.",
  },
  {
    slug: 'slack',
    name: 'Slack',
    iconUrl: FEATURED_ICONS.slack,
    category: 'chat',
    senderDomains: ['slack.com'],
    reason:
      'Import channels into Macro, and let agents search your conversations and post updates on your behalf.',
  },
  {
    slug: 'linear',
    name: 'Linear',
    iconUrl: FEATURED_ICONS.linear,
    category: 'tasks',
    senderDomains: ['linear.app'],
    reason:
      'Import Linear issues into Macro tasks, and let agents create and update issues straight from your email.',
  },
  {
    slug: 'jira',
    name: 'Jira',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_mArhw1/logo/orig',
    category: 'tasks',
    senderDomains: ['atlassian.net'],
    reason:
      'Import Jira issues into Macro tasks, and let agents create and update your issues straight from your email.',
  },
  {
    slug: 'asana',
    name: 'Asana',
    iconUrl: FEATURED_ICONS.asana,
    category: 'tasks',
    senderDomains: ['asana.com'],
    reason:
      'Import Asana tasks into Macro tasks, and let agents create and update them straight from your email.',
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_1NohVg/logo/orig',
    category: 'tasks',
    senderDomains: ['clickup.com'],
    reason:
      'Let agents create and update ClickUp tasks straight from your email, and keep all of your lists up to date.',
  },
  {
    slug: 'monday',
    name: 'monday.com',
    iconUrl: 'https://assets.pipedream.net/s.v0/app_mqeh5Q/logo/orig',
    category: 'tasks',
    senderDomains: ['monday.com'],
    reason:
      'Import monday.com items into Macro tasks, and let agents keep boards up to date as work moves.',
  },
  {
    slug: 'trello',
    name: 'Trello',
    iconUrl: FEATURED_ICONS.trello,
    category: 'tasks',
    senderDomains: ['trello.com'],
    reason:
      'Import Trello cards into Macro tasks, and let agents keep your boards up to date as the work moves along.',
  },
  {
    slug: 'notion',
    name: 'Notion',
    iconUrl: FEATURED_ICONS.notion,
    category: 'docs',
    senderDomains: ['notion.so', 'makenotion.com'],
    reason:
      'Import pages and wikis into your Macro Drive, and let agents search them when answering questions.',
  },
  {
    slug: 'airtable_oauth',
    name: 'Airtable',
    iconUrl: FEATURED_ICONS.airtable_oauth,
    category: 'databases',
    senderDomains: ['airtable.com'],
    reason:
      'Import records into the Macro CRM, and let agents read and update the records in all of your Airtable bases.',
  },
  {
    slug: 'github',
    name: 'GitHub',
    iconUrl: null,
    category: 'code',
    senderDomains: ['github.com'],
    reason:
      'Review pull requests in Macro, import issues into tasks, and give agents access to your code repositories.',
  },
  {
    slug: 'figma',
    name: 'Figma',
    iconUrl: FEATURED_ICONS.figma,
    category: 'design',
    senderDomains: ['figma.com'],
    reason:
      'Let agents read your Figma designs and the comments on them, and bring them into your docs and chats.',
  },
  {
    slug: 'posthog',
    name: 'PostHog',
    iconUrl: FEATURED_ICONS.posthog,
    category: 'analytics',
    senderDomains: ['posthog.com'],
    reason:
      'Let agents answer questions about product usage, funnels and trends in plain language from chat.',
  },
  {
    slug: 'mailchimp',
    name: 'Mailchimp',
    iconUrl: FEATURED_ICONS.mailchimp,
    category: 'marketing',
    senderDomains: ['mailchimp.com'],
    reason:
      'Let agents check on your Mailchimp campaigns and audiences without you having to leave your inbox.',
  },
  {
    slug: 'calendly_v2',
    name: 'Calendly',
    iconUrl: FEATURED_ICONS.calendly_v2,
    category: 'scheduling',
    senderDomains: ['calendly.com'],
    reason:
      "Let agents look up your Calendly bookings and event types when you're scheduling from your inbox.",
  },
];

/** A detected CRM or store always gets a slot: they shape the whole setup. */
const PRIORITY_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'crm',
  'ecommerce',
]);

/** Fewer messages than this is noise: one webinar invite isn't a CRM. */
const MIN_DETECTED_MESSAGES = 3;

/** Built into Macro, as Settings → Integrations labels it; the rest are MCP. */
const NATIVE_TOOLS: ReadonlySet<string> = new Set(['github']);

/** Every sender domain the inbox check asks the mail provider about. */
export const ONBOARDING_SENDER_DOMAINS: readonly string[] =
  RECOMMENDABLE_TOOLS.flatMap((tool) => tool.senderDomains);

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

type ScoredTool = { tool: RecommendableTool; messageCount: number };

/**
 * The tools the inbox shows the business uses, at most one per category: a
 * detected CRM and store first, then the rest by mail, topped up with
 * defaults. `counts` maps sender domain to recent message count.
 */
export function rankSuggestedTools(
  counts: Readonly<Record<string, number>>
): SuggestedTool[] {
  const scored: ScoredTool[] = RECOMMENDABLE_TOOLS.map((tool) => ({
    tool,
    messageCount: tool.senderDomains.reduce(
      (sum, domain) => sum + (counts[domain] ?? 0),
      0
    ),
  }));
  // The most-mailed tool in each category; ties keep the table's order.
  const leaders = new Map<ToolCategory, ScoredTool>();
  for (const entry of scored) {
    if (entry.messageCount < MIN_DETECTED_MESSAGES) continue;
    const leader = leaders.get(entry.tool.category);
    if (!leader || entry.messageCount > leader.messageCount)
      leaders.set(entry.tool.category, entry);
  }
  const byMail = [...leaders.values()].sort(
    (a, b) => b.messageCount - a.messageCount
  );
  const detected = [
    ...byMail.filter((entry) => PRIORITY_CATEGORIES.has(entry.tool.category)),
    ...byMail.filter((entry) => !PRIORITY_CATEGORIES.has(entry.tool.category)),
  ];
  const taken = new Set(detected.map((entry) => entry.tool.category));
  const defaults = DEFAULT_SUGGESTED_TOOLS.flatMap((slug) => {
    const entry = scored.find((candidate) => candidate.tool.slug === slug);
    if (!entry || taken.has(entry.tool.category)) return [];
    taken.add(entry.tool.category);
    return [{ ...entry, messageCount: 0 }];
  });
  return [...detected, ...defaults]
    .slice(0, SUGGESTED_TOOL_LIMIT)
    .map(({ tool, messageCount }) => ({
      tool: { slug: tool.slug, name: tool.name, iconUrl: tool.iconUrl },
      kind: NATIVE_TOOLS.has(tool.slug) ? 'native' : 'mcp',
      reason: tool.reason,
      messageCount,
    }));
}
