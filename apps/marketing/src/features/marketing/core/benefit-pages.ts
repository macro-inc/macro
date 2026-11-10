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
  | 'search-history';

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
      'Mention any task, email, or document to connect your work. Follow the links from either side.',
    accent: '#8caaf4',
    sections: [
      {
        id: 'pull-requests',
        title: 'Follow a PR back to the discussion.',
        description:
          'Mention a pull request in a channel and keep the code connected to the conversation. Follow the link to the PR, or come back to the channel to understand why the change was made.',
        scene: 'pr-channel',
      },
      {
        id: 'customer-context',
        title: 'Keep the customer email attached.',
        description:
          'Create a task from Macro Mail and the email stays linked as its source. Open the task from the thread, or go back to the original request from the task.',
        scene: 'task-email',
      },
      {
        id: 'follow-references',
        title: 'See where a document came up.',
        description:
          'Open References on a document to see the channels, tasks, and other documents that mention it. An @mention creates a link in both directions.',
        scene: 'references',
      },
      {
        id: 'related-tasks',
        title: 'Link tasks to each other.',
        description:
          'Mention one task inside another. Both tasks know about the connection, so you can follow related work without someone collecting all the links in one place.',
        scene: 'task-task',
      },
    ],
  },
  'product/tagging': {
    product: 'AI tagging',
    tutorial: 'ai-tagging',
    title: 'Let agents organize your work.',
    description:
      'Tag emails and tasks by customer, topic, and urgency. Agents keep it organized across your workspace.',
    accent: '#bba0e8',
    sections: [
      {
        id: 'automatic-tags',
        title: 'Automatically tag your Macro Mail.',
        description:
          'Set up a routine to tag new emails by what they’re about and how urgently they need a reply. A customer request can be tagged with the account, the topic, and its priority.',
        scene: 'auto-tags',
      },
      {
        id: 'tag-tasks',
        title: 'Sort new tasks as they arrive.',
        description:
          'Have an agent tag new tasks as Engineering, Customer support, or another team’s work. It can also set task priority from the request, so you don’t have to sort everything by hand.',
        scene: 'task-tags',
      },
      {
        id: 'shared-tags',
        title: 'Use one tag across your work.',
        description:
          'A customer’s email, the meeting notes, and the follow-up task can all have the same tag. Team tags are shared, so everyone can find the work that belongs together.',
        scene: 'shared-tags',
      },
      {
        id: 'urgent-work',
        title: 'Find what needs attention first.',
        description:
          'Use an Urgent tag across emails, tasks, and documents. Filter by that tag to see important work together, instead of checking each part of the workspace separately.',
        scene: 'tag-filter',
      },
    ],
  },
  'product/sharing': {
    product: 'Automatic permissions',
    tutorial: 'automatic-permissions',
    title: 'Share it. They can open it.',
    description:
      'Share through channels. Access follows membership as people join and leave.',
    accent: '#79c6ba',
    sections: [
      {
        id: 'share-in-channel',
        title: 'Share access through Macro Chat.',
        description:
          'When you share a document, task, or email in a channel, the people in that conversation can open it. The discussion and access stay together.',
        scene: 'channel-access',
      },
      {
        id: 'follow-membership',
        title: 'Give new teammates the context.',
        description:
          'Add someone to a channel and they get access to work already shared there. They can read the conversation and open the documents without asking you to share each one.',
        scene: 'membership',
      },
      {
        id: 'remove-access',
        title: 'Remove access when they leave.',
        description:
          'When someone leaves a channel, they lose the access granted by that channel. A former teammate or external client doesn’t keep that access just because you shared something months ago.',
        scene: 'leave-channel',
      },
    ],
  },
  'concepts/event-system': {
    product: 'Workspace events',
    tutorial: 'workspace-events',
    title: 'One event system for all your work.',
    description:
      'Email, chat, docs, tasks, and calls share one event system. Follow what happened across your whole workspace.',
    accent: '#d6b78c',
    sections: [
      {
        id: 'customer-events',
        title: 'Act on a customer’s email.',
        description:
          'Set up a routine for incoming customer email in Macro Mail. An agent can read the request, create a follow-up task, and draft a reply using the context in your workspace.',
        scene: 'customer-event',
      },
      {
        id: 'engineering-events',
        title: 'Keep the team up to date.',
        description:
          'Use a task’s status change to trigger a team update. For example, when an engineering task is completed, have an agent post what changed in the channel where the work was discussed.',
        scene: 'engineering-event',
      },
      {
        id: 'property-events',
        title: 'Follow up after a client call.',
        description:
          'For a real estate team, a finished call can start the follow-up. Have an agent use the transcript to draft a recap and create tasks for the properties the client wants to see.',
        scene: 'property-event',
      },
    ],
  },
  'product/search': {
    product: 'Unified search',
    tutorial: 'unified-search',
    title: 'One search for your whole workspace.',
    description:
      'Search emails, messages, docs, tasks, and calls together. Your agents search the same history, with timestamps.',
    accent: '#90bcd8',
    sections: [
      {
        id: 'search-workspace',
        title: 'Find it wherever it happened.',
        description:
          'Find an email from Macro Mail, a conversation from Macro Chat, or a detail in a document. You don’t have to remember which app it was in. Press / to search across your workspace.',
        scene: 'search',
      },
      {
        id: 'agent-search',
        title: 'Give agents one place to look.',
        description:
          'Across separate tools, agents have to make separate searches and piece the answers together. Some connectors have rate limits or don’t offer search. In Macro, agents search the same connected workspace you do.',
        scene: 'agent-search',
      },
      {
        id: 'search-history',
        title: 'Piece together what happened.',
        description:
          'Find the customer’s request, the team’s discussion, and the task that followed. Timestamps put each result in context, and links take you back to the original work.',
        scene: 'search-history',
      },
    ],
  },
};
