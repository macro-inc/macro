export type FeatureComparison = {
  id: string;
  question: string;
  competitor: string;
  rows: readonly { feature: string; macro: boolean; competitor: boolean }[];
  article?: { label: string; href: string };
  /** Evidence for maintainers; the public table stays compact. */
  sources: readonly string[];
};

export const emailComparisons: readonly FeatureComparison[] = [
  {
    id: 'superhuman',
    question: 'How does Macro compare with Superhuman Mail?',
    competitor: 'Superhuman Mail',
    rows: [
      {
        feature: 'Use your existing Gmail address',
        macro: true,
        competitor: true,
      },
      { feature: 'Multiple email accounts', macro: true, competitor: true },
      {
        feature: 'Unified inbox across email accounts',
        macro: true,
        competitor: false,
      },
      { feature: 'Keyboard shortcuts', macro: true, competitor: true },
      { feature: 'AI email drafting', macro: true, competitor: true },
      {
        feature: 'Agents that draft and send email',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Share individual live threads without forwarding',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Email, tasks, and chat in one inbox',
        macro: true,
        competitor: false,
      },
    ],
    article: {
      label: 'Macro vs. Superhuman',
      href: '/posts/superhuman-alternative',
    },
    sources: [
      'https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts',
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
        feature: 'Use your existing Gmail address',
        macro: true,
        competitor: true,
      },
      { feature: 'Keyboard shortcuts', macro: true, competitor: true },
      { feature: 'AI email drafting', macro: true, competitor: true },
      {
        feature: 'Read email beside your inbox',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Share individual live threads without forwarding',
        macro: true,
        competitor: false,
      },
      {
        feature: 'Email, tasks, and chat in one inbox',
        macro: true,
        competitor: false,
      },
      { feature: 'Open source', macro: true, competitor: false },
    ],
    sources: [
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
      { feature: 'Live document collaboration', macro: true, competitor: true },
      {
        feature: 'Agents that create and edit docs',
        macro: true,
        competitor: true,
      },
      { feature: 'Markdown import and export', macro: true, competitor: true },
      {
        feature: 'Upload PDFs, images, and other files',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Organize docs and files in folders',
        macro: true,
        competitor: false,
      },
      {
        feature: 'One set of tags across docs, email, and tasks',
        macro: true,
        competitor: false,
      },
      {
        feature: 'Read live email threads beside a doc',
        macro: true,
        competitor: false,
      },
      {
        feature: 'Share doc access through channel mentions',
        macro: true,
        competitor: false,
      },
    ],
    article: { label: 'Macro vs. Notion', href: '/posts/notion-alternative' },
    sources: [
      'https://www.notion.com/help/images-files-and-media',
      'https://www.notion.com/help/import-data-into-notion',
      'https://www.notion.com/help/export-your-content',
      'https://www.notion.com/help/create-a-subpage',
      'https://www.notion.com/help/notion-agent',
      'https://docs.macro.com/product/docs',
      'https://docs.macro.com/product/folders',
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
        feature: 'Status, priority, and assignees',
        macro: true,
        competitor: true,
      },
      { feature: 'Create tasks from email', macro: true, competitor: true },
      {
        feature: 'Create tasks from chat messages',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Update task status from GitHub',
        macro: true,
        competitor: true,
      },
      { feature: 'Full email client', macro: true, competitor: false },
      {
        feature: 'Built-in team chat / channels',
        macro: true,
        competitor: false,
      },
      { feature: 'Open source', macro: true, competitor: false },
    ],
    article: { label: 'Macro vs. Linear', href: '/posts/linear-alternative' },
    sources: [
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
        feature: 'Status, priority, and assignees',
        macro: true,
        competitor: true,
      },
      { feature: 'Task due dates', macro: true, competitor: true },
      { feature: 'Create tasks from email', macro: true, competitor: true },
      {
        feature: 'Update task status from GitHub',
        macro: true,
        competitor: true,
      },
      { feature: 'Full email client', macro: true, competitor: false },
      {
        feature: 'Built-in team chat / channels',
        macro: true,
        competitor: false,
      },
      { feature: 'Open source', macro: true, competitor: false },
    ],
    sources: [
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
        feature: 'Channels, threads, and reactions',
        macro: true,
        competitor: true,
      },
      {
        feature: 'Thread replies shown inline by default',
        macro: true,
        competitor: false,
      },
      {
        feature: 'Share docs and tasks with a channel',
        macro: true,
        competitor: true,
      },
      { feature: 'Video calls', macro: true, competitor: true },
      {
        feature: 'Agents that act on workspace content',
        macro: true,
        competitor: true,
      },
      { feature: 'Full email client', macro: true, competitor: false },
      {
        feature: 'Email, tasks, and chat in one inbox',
        macro: true,
        competitor: false,
      },
    ],
    article: { label: 'Macro vs. Slack', href: '/posts/slack-alternative' },
    sources: [
      'https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions-',
      'https://slack.com/help/articles/15678967614611-Manage-access-permissions-for-canvases-and-lists',
      'https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack',
      'https://slack.com/help/articles/202026038-How-to-work-with-Slackbot',
    ],
  },
];
