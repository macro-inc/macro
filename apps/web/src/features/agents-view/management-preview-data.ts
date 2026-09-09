/** Sample data for the Routines and Agents design previews; no live resources. */
export type ManagementKind = 'routines' | 'agents';
export interface PreviewResource {
  id: string;
  name: string;
  description: string;
  scope: 'Mine' | 'Team';
  enabled: boolean;
  instructions: string;
  schedule: string;
  time: string;
  tools: string[];
  model: string;
}

export const PREVIEW_TOOLS = [
  {
    id: 'drive',
    name: 'Drive',
    description: 'Read and organize documents and files.',
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Find messages and prepare email drafts.',
  },
  {
    id: 'chat',
    name: 'Chat',
    description: 'Read conversations and share updates.',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Check availability and upcoming events.',
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Review work, priorities, and deadlines.',
  },
  {
    id: 'web',
    name: 'Web search',
    description: 'Research questions across the web.',
  },
] as const;

export const PREVIEW_RESOURCES: Record<ManagementKind, PreviewResource[]> = {
  routines: [
    {
      id: 'morning-briefing',
      name: 'Morning briefing',
      description:
        'Your calendar, priorities, and anything that needs a reply.',
      scope: 'Mine',
      enabled: true,
      schedule: 'Every weekday',
      time: '09:00',
      tools: ['calendar', 'tasks', 'email'],
      model: 'Auto',
      instructions:
        'Prepare a short morning briefing. Review my calendar, tasks due today, and important emails that need a reply. Start with the three things that deserve my attention and link to the original items.',
    },
    {
      id: 'inbox-review',
      name: 'Inbox review',
      description: 'Find the conversations that could use a follow-up.',
      scope: 'Mine',
      enabled: true,
      schedule: 'Every day',
      time: '16:00',
      tools: ['email', 'tasks'],
      model: 'Auto',
      instructions:
        'Review important conversations from the last week. Identify emails I have not replied to and commitments that need a follow-up. Prepare a concise list with suggested next steps.',
    },
    {
      id: 'weekly-review',
      name: 'Weekly review',
      description: 'A Friday recap of progress, decisions, and open questions.',
      scope: 'Mine',
      enabled: false,
      schedule: 'Every Friday',
      time: '15:00',
      tools: ['tasks', 'chat', 'drive'],
      model: 'Auto',
      instructions:
        'Summarize this week’s completed work, important decisions, and outstanding questions. Group the recap by project and finish with priorities for next week.',
    },
    {
      id: 'customer-pulse',
      name: 'Customer pulse',
      description: 'Keep the team informed about customer conversations.',
      scope: 'Team',
      enabled: true,
      schedule: 'Every weekday',
      time: '10:00',
      tools: ['email', 'chat'],
      model: 'Auto',
      instructions:
        'Summarize customer feedback and unresolved requests from the last business day. Highlight recurring themes and link to the relevant conversations.',
    },
  ],
  agents: [
    {
      id: 'personal-assistant',
      name: 'Personal assistant',
      description: 'A thoughtful partner for your day-to-day work.',
      scope: 'Mine',
      enabled: true,
      schedule: 'Every weekday',
      time: '09:00',
      tools: ['email', 'calendar', 'tasks'],
      model: 'Auto',
      instructions:
        'Help me stay on top of my day. Connect the dots between my calendar, tasks, and inbox. Be concise, suggest concrete next steps, and ask before making changes on my behalf.',
    },
    {
      id: 'research-partner',
      name: 'Research partner',
      description: 'Explore a question and turn findings into a useful brief.',
      scope: 'Mine',
      enabled: true,
      schedule: 'Every weekday',
      time: '09:00',
      tools: ['web', 'drive'],
      model: 'Auto',
      instructions:
        'Research questions carefully, distinguish evidence from assumptions, and cite your sources. Start with a concise answer, then explain the findings and tradeoffs that matter.',
    },
    {
      id: 'writing-partner',
      name: 'Writing partner',
      description: 'Clearer drafts, sharper thinking, and a consistent voice.',
      scope: 'Mine',
      enabled: false,
      schedule: 'Every weekday',
      time: '09:00',
      tools: ['drive', 'email'],
      model: 'Auto',
      instructions:
        'Help me write clearly. Preserve my intent and voice, remove unnecessary words, and structure information around what the reader needs to know.',
    },
    {
      id: 'support-partner',
      name: 'Support partner',
      description: 'Find context and draft thoughtful customer responses.',
      scope: 'Team',
      enabled: true,
      schedule: 'Every weekday',
      time: '09:00',
      tools: ['chat', 'drive', 'email'],
      model: 'Auto',
      instructions:
        'Use our documents and conversation history to answer customer questions. Draft helpful, specific responses and flag uncertainty rather than guessing.',
    },
  ],
};

export const PREVIEW_TEMPLATES: Record<
  ManagementKind,
  { name: string; description: string; tools: string[]; instructions: string }[]
> = {
  routines: [
    {
      name: 'Prepare for meetings',
      description:
        'Get the context, open questions, and documents you need before your day begins.',
      tools: ['calendar', 'drive'],
      instructions:
        'Review today’s meetings. For each meeting, collect relevant documents, recent conversations, and open questions. Produce a short preparation brief.',
    },
    {
      name: 'Never miss a follow-up',
      description:
        'Turn loose ends in your inbox into a clear list of next steps.',
      tools: ['email', 'tasks'],
      instructions:
        'Identify conversations waiting on me and commitments that are due. Summarize the next steps and suggest follow-up drafts.',
    },
    {
      name: 'Share a team digest',
      description:
        'Bring important decisions and project updates together in one place.',
      tools: ['chat', 'tasks'],
      instructions:
        'Create a digest of important team conversations, decisions, and project updates from the past week.',
    },
    {
      name: 'Keep your files organized',
      description:
        'Review recent files and suggest a more useful home for each one.',
      tools: ['drive'],
      instructions:
        'Review recently created documents. Suggest clear names, tags, and folders. Ask for approval before moving or renaming anything.',
    },
  ],
  agents: [
    {
      name: 'Cursor',
      description: 'An agent for code, debugging, and development workflows.',
      tools: ['drive'],
      instructions:
        'Help with coding, debugging, and reviewing changes. Explain the work clearly and verify the result.',
    },
    {
      name: 'Hermes',
      description: 'A general-purpose agent for research and everyday work.',
      tools: ['web', 'drive', 'tasks'],
      instructions:
        'Help research questions, organize information, and complete everyday tasks using available tools.',
    },
    {
      name: 'Grok Bot',
      description: 'A conversational agent for questions, ideas, and research.',
      tools: ['web', 'chat'],
      instructions:
        'Answer questions, explore ideas, and research topics with clear, grounded responses.',
    },
  ],
};

export const DEFAULT_MACRO_AGENT = {
  name: 'Macro',
  description:
    'Your default agent for work across email, chats, documents, and tasks.',
  tools: ['email', 'chat', 'drive', 'tasks', 'calendar'],
  instructions:
    'Help the user get work done across their workspace. Use relevant context from email, chats, documents, tasks, and calendar, and communicate clearly.',
};
