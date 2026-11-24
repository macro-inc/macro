import type { TutorialVideoId } from './tutorial-videos';

export type BenefitScene =
  | 'pr-channel'
  | 'task-email'
  | 'references'
  | 'task-task'
  | 'auto-tags'
  | 'task-tags'
  | 'shared-tags'
  | 'tag-filter'
  | 'channel-access'
  | 'membership'
  | 'leave-channel'
  | 'customer-event'
  | 'engineering-event'
  | 'property-event'
  | 'search'
  | 'agent-search'
  | 'parallel-search';

type BenefitPage = {
  tutorial: TutorialVideoId;
  product:
    | 'Company graph'
    | 'AI tagging'
    | 'Automatic permissions'
    | 'Workspace events'
    | 'Unified search';
  title: string;
  description: string;
  accent: string;
  sections: {
    id: string;
    title: string;
    description: string;
    scene: BenefitScene;
  }[];
};

/** Marketing overviews on the original URLs; MDX remains the full reference. */
export const BENEFIT_PAGES: Record<string, BenefitPage> = {
  'concepts/mentions': {
    product: 'Company graph',
    tutorial: 'company-graph',
    title: 'Everything links both ways.',
    description:
      'Type @ anywhere to link emails, chats, docs, tasks, calls, and PRs. Every connection works in both directions.',
    accent: '#8caaf4',
    sections: [
      {
        id: 'pull-requests',
        title: 'Follow a PR back to the discussion.',
        description:
          'Mention a Macro GitHub PR in Macro Chat to keep the code tied to the discussion. Jump from the thread to the diff, or back from the PR to see why the change happened.',
        scene: 'pr-channel',
      },
      {
        id: 'customer-context',
        title: 'Keep the customer email attached.',
        description:
          'Create a task straight from Macro Mail and the thread stays attached as its source. Anyone picking up the work in Macro Tasks can read the customer’s exact words in one click.',
        scene: 'task-email',
      },
      {
        id: 'follow-references',
        title: 'See where a document came up.',
        description:
          'Open References on any doc in Macro Docs to see every channel, task, and email pointing to it. Mention it once and both sides stay linked automatically.',
        scene: 'references',
      },
      {
        id: 'related-tasks',
        title: 'Link tasks to each other.',
        description:
          'Mention one task inside another in Macro Tasks and both sides link automatically. Follow blockers and related work without anyone manually maintaining a tracker.',
        scene: 'task-task',
      },
    ],
  },
  'product/tagging': {
    product: 'AI tagging',
    tutorial: 'ai-tagging',
    title: 'Let agents organize your work.',
    description:
      'One shared tag system across email, tasks, docs, and files—kept organized automatically by agents.',
    accent: '#bba0e8',
    sections: [
      {
        id: 'automatic-tags',
        title: 'Automatically tag your Macro Mail.',
        description:
          'Run a routine on incoming Macro Mail to tag threads by customer, topic, and urgency the moment they land—no manual filing.',
        scene: 'auto-tags',
      },
      {
        id: 'tag-tasks',
        title: 'Sort new tasks as they arrive.',
        description:
          'Let Macro Agents categorize new Macro Tasks by team and set priority from the request itself, so triage happens before anyone opens the board.',
        scene: 'task-tags',
      },
      {
        id: 'shared-tags',
        title: 'Use one tag across your work.',
        description:
          'Put the same tag on a customer’s Macro Mail thread, Macro Calls notes, and follow-up Macro Tasks. Because tags are shared across the team, everyone sees the full picture.',
        scene: 'shared-tags',
      },
      {
        id: 'urgent-work',
        title: 'Find what needs attention first.',
        description:
          'Filter by an Urgent tag to see critical emails, tasks, and docs in one view instead of checking five different tabs.',
        scene: 'tag-filter',
      },
    ],
  },
  'product/sharing': {
    product: 'Automatic permissions',
    tutorial: 'automatic-permissions',
    title: 'Share it. They can open it.',
    description:
      'Stop fielding “can you grant me access?” pings. Share work in a channel and access follows membership automatically.',
    accent: '#79c6ba',
    sections: [
      {
        id: 'share-in-channel',
        title: 'Share access through Macro Chat.',
        description:
          'Drop a doc from Macro Docs, a thread from Macro Mail, or a task into Macro Chat and every member can open it immediately—just like attaching a file to an email.',
        scene: 'channel-access',
      },
      {
        id: 'follow-membership',
        title: 'Give new teammates the context.',
        description:
          'Add a new teammate to a channel and they automatically unlock every doc, email, and task already shared there—no one-by-one sharing needed.',
        scene: 'membership',
      },
      {
        id: 'remove-access',
        title: 'Remove access when they leave.',
        description:
          'Remove someone from a channel and their channel-granted access disappears right away. Former contractors or clients don’t keep quiet links to old docs.',
        scene: 'leave-channel',
      },
    ],
  },
  'concepts/event-system': {
    product: 'Workspace events',
    tutorial: 'workspace-events',
    title: 'One event system for all your work.',
    description:
      'Every email, message, task change, and call fires on one unified event bus—so agents react the moment work happens.',
    accent: '#d6b78c',
    sections: [
      {
        id: 'customer-events',
        title: 'Act on a customer’s email.',
        description:
          'Trigger Macro Routines whenever a customer writes into Macro Mail. Macro Agents read the request, open follow-up Macro Tasks, and draft a reply using past threads and calls.',
        scene: 'customer-event',
      },
      {
        id: 'engineering-events',
        title: 'Keep the team up to date.',
        description:
          'Trigger an update when a status changes in Macro Tasks. As soon as an engineering task ships, Macro Agents post what changed right in Macro Chat.',
        scene: 'engineering-event',
      },
      {
        id: 'property-events',
        title: 'Follow up after a client call.',
        description:
          'Kick off follow-ups the second Macro Calls wraps up. Macro Agents read the transcript, draft a client recap in Macro Mail, and create next-step Macro Tasks automatically.',
        scene: 'property-event',
      },
    ],
  },
  'product/search': {
    product: 'Unified search',
    tutorial: 'unified-search',
    title: 'One search for your whole workspace.',
    description:
      'Search every email, channel, doc, task, file, and call transcript in one box—for both your team and your agents.',
    accent: '#90bcd8',
    sections: [
      {
        id: 'search-workspace',
        title: 'Find it wherever it happened.',
        description:
          'Press / to search across Macro Mail, Macro Chat, Macro Docs, and Macro Calls at once—no guessing which app something lives in.',
        scene: 'search',
      },
      {
        id: 'agent-search',
        title: 'Give agents one place to look.',
        description:
          'Across disconnected SaaS apps, agents burn tool calls hitting rate-limited connectors just to piece together basic history. In Macro, Macro Agents search one unified index with full permissions intact.',
        scene: 'agent-search',
      },
      {
        id: 'search-history',
        title: 'Search in parallel across your workspace.',
        description:
          'Macro Agents fire parallel queries across emails, threads, docs, tasks, and call transcripts, then synthesize one cited answer linked straight to the source records.',
        scene: 'parallel-search',
      },
    ],
  },
};
