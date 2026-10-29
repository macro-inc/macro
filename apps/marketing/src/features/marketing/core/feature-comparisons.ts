// Workflow comparisons reviewed 2026-10-20 against official product docs below.
// A partial mark describes a concrete scope, setup, or product-boundary difference.
// Do not turn subjective speed or quality claims into check/slash ratings.
export type FeatureComparison = {
  id: string;
  question: string;
  competitor: string;
  rows: readonly {
    feature: string;
    macro: boolean | 'partial';
    competitor: boolean | 'partial';
    macroNote?: string;
    competitorNote?: string;
  }[];
  article?: { label: string; href: string };
  /** Evidence for maintainers; the public table stays compact. */
  sources: readonly string[];
};

// Compare verified multi-account support, not a combined feed: Superhuman's
// Help Center and general blog contradict each other on a unified inbox.
export const emailComparisons: readonly FeatureComparison[] = [
  {
    id: 'superhuman',
    question: 'How does Macro compare with Superhuman Mail?',
    competitor: 'Superhuman Mail',
    rows: [
      {
        feature: 'Keyboard navigation and command menu',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Manage multiple email accounts',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Share live email threads with teammates',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Draft replies using docs and meeting context',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Broader document and meeting context comes through Superhuman Go and its connectors, beyond Mail itself.',
      },
      {
        feature: 'Email, tasks, and chat in one feed',
        macro: true,
        competitor: false,
      },
    ],
    article: {
      label: 'Macro vs. Superhuman',
      href: '/posts/superhuman-alternative',
    },
    sources: [
      'https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts',
      'https://help.superhuman.com/hc/en-us/articles/46242137727757-Explore-Superhuman-Go-agents-and-connectors',
      'https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts',
      'https://help.superhuman.com/hc/en-us/articles/46005722297229-Unified-Inbox-Workaround',
      'https://blog.superhuman.com/web-email-client-guide/',
      'https://help.superhuman.com/hc/en-us/articles/46005593675917-Shared-Conversations-and-Team-Comments',
      'https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server',
    ],
  },
  {
    id: 'gmail',
    question: 'How does Macro compare with Gmail?',
    competitor: 'Gmail',
    rows: [
      {
        feature: 'Keyboard navigation and command menu',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Gmail supports navigation and action shortcuts after enabling them. Its shortcut help lists commands rather than offering a searchable action menu.',
      },
      {
        feature: 'Manage multiple email accounts',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Share live email threads with teammates',
        macro: true,
        competitor: false,
      },
      {
        feature: 'Draft replies using docs and meeting context',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Email, tasks, and chat in one feed',
        macro: true,
        competitor: false,
      },
    ],
    sources: [
      'https://support.google.com/mail/answer/6078445',
      'https://support.google.com/accounts/answer/1721977',
      'https://support.google.com/mail/answer/6594',
      'https://support.google.com/mail/answer/14355636',
      'https://support.google.com/mail/answer/6115187',
      'https://support.google.com/mail/answer/138350',
    ],
  },
];

export const documentComparisons: readonly FeatureComparison[] = [
  {
    id: 'notion',
    question: 'How does Macro compare with Notion?',
    competitor: 'Notion',
    rows: [
      {
        feature: 'Dedicated task manager',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Notion supports task databases, My tasks, and sprints. Set up or duplicate a database/template and map its task properties.',
      },
      {
        feature: 'Dedicated CRM',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Build or duplicate a CRM with Notion databases and templates. Macro has dedicated company, contact, and pipeline tools.',
      },
      {
        feature: 'Read live email beside your document',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Notion Mail and email connectors provide email access separately; they are not a live mailbox pane beside the document.',
      },
      { feature: 'Live document collaboration', macro: true, competitor: true },
      {
        feature: 'Agents that edit documents with you',
        macro: true,
        competitor: true,
      },
      { feature: 'Custom pages and databases', macro: true, competitor: true },
    ],
    article: { label: 'Macro vs. Notion', href: '/posts/notion-alternative' },
    sources: [
      'https://www.notion.com/help/sprints',
      'https://www.notion.com/help/guides/getting-started-with-templates-for-your-team',
      'https://www.notion.com/help/guides/simple-crm-for-strengthening-client-relationships-and-managing-work',
      'https://www.notion.com/help/get-started-with-notion-mail',
      'https://www.notion.com/help/images-files-and-media',
      'https://www.notion.com/help/import-data-into-notion',
      'https://www.notion.com/help/export-your-content',
      'https://www.notion.com/help/create-a-subpage',
      'https://www.notion.com/help/notion-agent',
      'https://docs.macro.com/product/docs',
      'https://docs.macro.com/product/drive',
      'https://docs.macro.com/concepts/blocks',
    ],
  },
];

export const taskComparisons: readonly FeatureComparison[] = [
  {
    id: 'linear',
    question: 'How does Macro compare with Linear?',
    competitor: 'Linear',
    rows: [
      {
        feature: 'Create tasks in built-in team chat',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Linear supports issue creation and synced conversations through its Slack integration; team chat is a separate app.',
      },
      {
        feature: 'Keep the live email thread with a task',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Linear Asks supports two-way email threads for configured intake addresses. It is not a connection to your full personal or work inbox.',
      },
      {
        feature: 'Agents create and update tasks',
        macro: true,
        competitor: true,
      },
      { feature: 'GitHub updates task status', macro: true, competitor: true },
      {
        feature: 'Tasks, email, and messages in one inbox',
        macro: true,
        competitor: false,
      },
    ],
    article: { label: 'Macro vs. Linear', href: '/posts/linear-alternative' },
    sources: [
      'https://linear.app/docs/linear-asks-email',
      'https://linear.app/docs/mcp',
      'https://linear.app/docs/agents-in-linear',
      'https://linear.app/docs/creating-issues',
      'https://linear.app/docs/slack',
      'https://linear.app/docs/github',
    ],
  },
  {
    id: 'jira',
    question: 'How does Macro compare with Jira?',
    competitor: 'Jira',
    rows: [
      {
        feature: 'Create tasks in built-in team chat',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Create work items from Slack through Atlassian integrations; team chat remains a separate app.',
      },
      {
        feature: 'Keep the live email thread with a task',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Email handlers and Jira Service Management turn configured incoming mail into work items and comments, rather than opening your full email thread in a mailbox pane.',
      },
      {
        feature: 'Agents create and update tasks',
        macro: true,
        competitor: true,
      },
      { feature: 'GitHub updates task status', macro: true, competitor: true },
      {
        feature: 'Tasks, email, and messages in one inbox',
        macro: true,
        competitor: false,
      },
    ],
    sources: [
      'https://support.atlassian.com/jira-software-cloud/docs/create-work-items-with-rovo/',
      'https://support.atlassian.com/rovo/docs/use-a-rovo-agent-to-sync-conversations-between-slack-and-jsm/',
      'https://support.atlassian.com/jira-cloud-administration/docs/create-issues-and-comments-from-email/',
      'https://support.atlassian.com/jira-cloud-administration/docs/integrate-with-github/',
      'https://support.atlassian.com/cloud-automation/docs/jira-automation-triggers/',
    ],
  },
];

export const chatComparisons: readonly FeatureComparison[] = [
  {
    id: 'slack',
    question: 'How does Macro compare with Slack?',
    competitor: 'Slack',
    rows: [
      {
        feature: 'Share a live email thread in chat',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Slack can receive forwarded emails or email-app posts. That is different from sharing the original mailbox thread with later replies.',
      },
      {
        feature: 'Read thread replies inline',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'Slack primarily opens replies in a thread pane. Individual replies can also be sent to the channel.',
      },
      {
        feature: 'Open docs and tasks beside the conversation',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Agents create work in the conversation',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Chat, email, and task updates in one inbox',
        macro: true,
        competitor: false,
      },
    ],
    article: { label: 'Macro vs. Slack', href: '/posts/slack-alternative' },
    sources: [
      'https://slack.com/help/articles/206819278-Send-emails-to-Slack',
      'https://slack.com/help/articles/27452748828179-Use-lists-in-Slack',
      'https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions-',
      'https://slack.com/help/articles/15678967614611-Manage-access-permissions-for-canvases-and-lists',
      'https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack',
      'https://slack.com/help/articles/202026038-How-to-work-with-Slackbot',
    ],
  },
];

// Reviewed 2026-10-20 against the sources below and docs/agent-guide/crm.md.
// A partial reporting mark means agent-generated summaries, not dedicated dashboards.
// Connected workspace tools receive partial credit rather than a cross.
export const crmComparisons: readonly FeatureComparison[] = [
  {
    id: 'salesforce',
    question: 'How does Macro compare with Salesforce?',
    competitor: 'Salesforce',
    rows: [
      {
        feature: 'Sales pipelines and custom fields',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Draft follow-ups using customer context',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Sales reporting',
        macro: 'partial',
        competitor: true,
        macroNote:
          'Agent-generated pipeline summaries; no dedicated sales reporting dashboard.',
      },
      {
        feature: 'CRM, email, chat, docs, and calls in one app',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'CRM activity is linked to collaboration tools and connected apps. Macro keeps email, calls, documents, and team chat in the same workspace.',
      },
    ],
    sources: [
      'https://www.salesforce.com/sales/cloud/guide/',
      'https://help.salesforce.com/s/articleView?id=sf.einstein_sales_emails_draft.htm&language=en_US&type=5',
      'https://help.salesforce.com/s/articleView?id=sf.collaboration_admin_welcome.htm&language=en_US&type=5',
      'https://trailhead.salesforce.com/content/learn/projects/customize-a-sales-path-for-your-team/work-with-opportunities-in-the-kanban-view',
      'https://help.salesforce.com/s/articleView?id=xcloud.lex_pro_tips_activity_timeline.htm&language=en_US&type=5',
    ],
  },
  {
    id: 'hubspot',
    question: 'How does Macro compare with HubSpot?',
    competitor: 'HubSpot',
    rows: [
      {
        feature: 'Sales pipelines and custom fields',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Draft follow-ups using customer context',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Sales reporting',
        macro: 'partial',
        competitor: true,
        macroNote:
          'Agent-generated pipeline summaries; no dedicated sales reporting dashboard.',
      },
      {
        feature: 'CRM, email, chat, docs, and calls in one app',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'CRM activity is linked to collaboration tools and connected apps. Macro keeps email, calls, documents, and team chat in the same workspace.',
      },
    ],
    sources: [
      'https://knowledge.hubspot.com/object-settings/select-properties-to-show-on-records-in-board-view',
      'https://www.hubspot.com/products/email-integration',
      'https://www.hubspot.com/products/sales/sales-reports',
      'https://knowledge.hubspot.com/generate-sales-email-templates-with-ai-assistant',
      'https://knowledge.hubspot.com/integrations/connect-google-drive-to-hubspot',
    ],
  },
  {
    id: 'attio',
    question: 'How does Macro compare with Attio?',
    competitor: 'Attio',
    rows: [
      {
        feature: 'Sales pipelines and custom fields',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Draft follow-ups using customer context',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Sales reporting',
        macro: 'partial',
        competitor: true,
        macroNote:
          'Agent-generated pipeline summaries; no dedicated sales reporting dashboard.',
      },
      {
        feature: 'CRM, email, chat, docs, and calls in one app',
        macro: true,
        competitor: 'partial',
        competitorNote:
          'CRM activity is linked to collaboration tools and connected apps. Macro keeps email, calls, documents, and team chat in the same workspace.',
      },
    ],
    sources: [
      'https://attio.com/help/reference/managing-your-data/attributes/create-manage-attributes',
      'https://attio.com/help/academy/introduction/reports',
      'https://attio.com/help/reference/attio-ai/ask-attio/chat-with-ask-attio',
      'https://attio.com/help/reference/apps/communication-apps/slack-app',
      'https://attio.com/help/reference/apps/data-and-enrichment-apps/notion-app',
    ],
  },
];
