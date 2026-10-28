import type { FeatureComparison } from './feature-comparisons';

type Provider = 'superhuman' | 'notion' | 'slack' | 'linear' | 'clickup';
type Availability = boolean | 'partial';
type OverviewRow = {
  feature: string;
  cells: readonly [
    Availability,
    Availability,
    Availability,
    Availability,
    Availability,
  ];
  notes?: Partial<Record<Provider, string>>;
};

// Reviewed against the official sources below on 2026-10-21. Compare the named
// workspace, not every separate product or integration sold by its parent.
const rows: readonly OverviewRow[] = [
  {
    feature: 'Full email client',
    cells: [true, false, false, false, false],
    notes: {
      notion:
        'Notion Mail is separate from the Notion workspace; email connectors let agents work with mail.',
      clickup:
        'Email in ClickUp sends and receives messages inside task activity rather than providing a full mailbox.',
      linear:
        'Linear Asks supports email intake and replies, rather than a full personal or work mailbox.',
    },
  },
  { feature: 'Team chat / channels', cells: [false, false, true, false, true] },
  { feature: 'Task management', cells: [false, true, true, true, true] },
  { feature: 'Collaborative docs', cells: [false, true, true, true, true] },
  {
    feature: 'Dedicated CRM',
    cells: [false, 'partial', 'partial', false, 'partial'],
    notes: {
      notion:
        'Build a CRM with Notion databases and templates rather than dedicated company, contact, and pipeline tools.',
      slack:
        'Slack CRM is available on Business+ and requires setting up a Salesforce Free Edition org.',
      clickup:
        'Build a CRM using tasks, custom fields, relationships, and CRM templates.',
    },
  },
  { feature: 'Video calls', cells: [false, false, true, false, true] },
  { feature: 'AI agents', cells: [true, true, true, true, true] },
  {
    feature: 'Email, tasks, and chat in one inbox',
    cells: [false, false, false, false, false],
    notes: {
      notion:
        'Notion Inbox contains workspace notifications; connected mail and Notion Mail are different interfaces.',
      clickup:
        'ClickUp Inbox groups workspace notifications. Task emails are read in task activity rather than a full email inbox.',
    },
  },
];

const providers: readonly {
  id: Provider;
  competitor: string;
  column: 0 | 1 | 2 | 3 | 4;
  sources: readonly string[];
}[] = [
  {
    id: 'superhuman',
    competitor: 'Superhuman Mail',
    column: 0,
    sources: [
      'https://help.superhuman.com/hc/en-us/articles/46005854346893-Email-Assistant-by-Superhuman-Mail-Gmail',
      'https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts',
    ],
  },
  {
    id: 'notion',
    competitor: 'Notion',
    column: 1,
    sources: [
      'https://www.notion.com/help/notion-agent',
      'https://www.notion.com/help/guides/simple-crm-for-strengthening-client-relationships-and-managing-work',
      'https://www.notion.com/help/connect-mail-to-custom-agents',
      'https://www.notion.com/help/manage-your-inbox-with-notion-agent',
    ],
  },
  {
    id: 'slack',
    competitor: 'Slack',
    column: 2,
    sources: [
      'https://slack.com/help/articles/27452748828179-Use-lists-in-Slack',
      'https://slack.com/help/articles/19470130744595-Discover-ways-to-use-canvases',
      'https://slack.com/help/articles/36218786859667-Use-Agentforce-in-Slack',
      'https://slack.com/help/articles/45816806110739-Set-up-and-manage-Slack-CRM',
      'https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack',
    ],
  },
  {
    id: 'linear',
    competitor: 'Linear',
    column: 3,
    sources: [
      'https://linear.app/docs/documents',
      'https://linear.app/docs/agents-in-linear',
      'https://linear.app/docs/linear-asks-email',
    ],
  },
  {
    id: 'clickup',
    competitor: 'ClickUp',
    column: 4,
    sources: [
      'https://help.clickup.com/hc/en-us/articles/17650012803735-Use-Custom-Fields-for-CRM',
      'https://clickup.com/features/chat',
      'https://clickup.com/features/docs',
      'https://help.clickup.com/hc/en-us/articles/27613433847063-What-are-SyncUps',
      'https://help.clickup.com/hc/en-us/articles/37045015737111-What-are-Autopilot-Agents',
      'https://help.clickup.com/hc/en-us/sections/6131842134935-Email',
      'https://help.clickup.com/hc/en-us/articles/15147158275735-Intro-to-Inbox-on-mobile',
    ],
  },
];

export const migrationComparisons: readonly FeatureComparison[] = providers.map(
  (provider) => ({
    id: provider.id,
    question: `How does Macro compare with ${provider.competitor}?`,
    competitor: provider.competitor,
    sources: provider.sources,
    rows: rows.map((row) => ({
      feature: row.feature,
      macro: true,
      competitor: row.cells[provider.column],
      competitorNote: row.notes?.[provider.id],
    })),
  })
);
