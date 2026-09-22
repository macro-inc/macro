export type ViewGuide = {
  title: string;
  connector?: string;
  steps: readonly { title: string; description: string }[];
};

export const VIEW_GUIDES: Record<string, ViewGuide> = {
  home: {
    title: 'Home',
    steps: [
      {
        title: 'See your work together',
        description:
          'Home brings recent documents, conversations, email, and events into one place.',
      },
      {
        title: 'Open the context',
        description:
          'Select an item to preview it beside your list. Use the filter to narrow what you see.',
      },
      {
        title: 'Start something new',
        description:
          'Choose New chat to work with an agent, or use Create in the sidebar to start a document, task, or conversation.',
      },
    ],
  },
  calendar: {
    title: 'Calendar',
    connector: 'Google',
    steps: [
      {
        title: 'Make space for your day',
        description:
          'Connect your Google account to bring your calendars into Macro.',
      },
      {
        title: 'Find the right moment',
        description:
          'Move between dates and calendar views. Choose which calendars to show to focus on the schedule you need.',
      },
      {
        title: 'Keep the details close',
        description:
          'Open an event to see its time, participants, and meeting details. Create a new event when you need to plan something.',
      },
    ],
  },
  inbox: {
    title: 'Inbox',
    steps: [
      {
        title: 'A home for what needs you',
        description:
          'Your inbox brings updates and notifications together so you can see what needs your attention.',
      },
      {
        title: 'Open the context',
        description:
          'Open an item to see the conversation or document behind the update.',
      },
      {
        title: 'Make room for what’s next',
        description:
          'Mark handled items done. Use filters to focus on the work that matters now.',
      },
    ],
  },
  mail: {
    title: 'Email',
    connector: 'Google',
    steps: [
      {
        title: 'Your inboxes, together',
        description:
          'Connect work and personal Google accounts, then choose an inbox or see them together.',
      },
      {
        title: 'Find the conversation',
        description:
          'Search and filter your email. Open a thread to read the full conversation beside your list.',
      },
      {
        title: 'Keep the conversation moving',
        description:
          'Reply in the thread or compose a new email. Archive mail when you’re done with it.',
      },
    ],
  },
  documents: {
    title: 'Documents',
    connector: 'Notion',
    steps: [
      {
        title: 'A place for your ideas',
        description:
          'Create a document or bring your existing files into Macro. Search and filter to find them again.',
      },
      {
        title: 'Connect the context',
        description:
          'In a document, type @ to mention people or link related work.',
      },
      {
        title: 'Think together',
        description:
          'Share a document and use comments to keep feedback close to the work.',
      },
    ],
  },
  tasks: {
    title: 'Tasks',
    connector: 'Linear',
    steps: [
      {
        title: 'Turn plans into progress',
        description:
          'Create a task with a clear next step, or connect Linear to bring your issues into Macro.',
      },
      {
        title: 'Give work an owner',
        description:
          'Open a task to set its assignee, due date, and status. Add context so the next step is clear.',
      },
      {
        title: 'Find your focus',
        description:
          'Filter and group your tasks to see what’s yours, what’s next, and what’s done.',
      },
    ],
  },
  channels: {
    title: 'Channels',
    connector: 'Slack',
    steps: [
      {
        title: 'Bring the team together',
        description:
          'Create a channel around a team, project, or topic. Invite the people who need the context.',
      },
      {
        title: 'Keep work in the conversation',
        description:
          'Share documents and mention teammates directly in a message.',
      },
      {
        title: 'Follow the thread',
        description:
          'Reply in threads to keep discussions easy to follow, and start a call when a conversation needs one.',
      },
    ],
  },
  companies: {
    title: 'Customers',
    connector: 'HubSpot or Attio',
    steps: [
      {
        title: 'Know who you’re working with',
        description:
          'Keep companies, contacts, and customer context together in your team’s workspace.',
      },
      {
        title: 'See the whole relationship',
        description:
          'Open a company to view its contacts and details. Update properties as the relationship develops.',
      },
      {
        title: 'Make your pipeline useful',
        description:
          'Use filters and saved views to focus on the right companies. Switch to the board to see work by stage.',
      },
    ],
  },
  agents: {
    title: 'Agents',
    steps: [
      {
        title: 'Start with an outcome',
        description:
          'Tell an agent what you want to accomplish. Include the context that will help it get there.',
      },
      {
        title: 'Bring your tools',
        description:
          'Manage connections in Settings so your agent can work with the tools you already use.',
      },
      {
        title: 'Stay in the loop',
        description:
          'Follow progress in the conversation and review actions when the agent asks for your input.',
      },
    ],
  },
  calls: {
    title: 'Calls',
    steps: [
      {
        title: 'Pick up the conversation',
        description:
          'Find your recent calls here, alongside the work they relate to.',
      },
      {
        title: 'Revisit the details',
        description:
          'Open a call to review its available transcript and catch up on what was discussed.',
      },
      {
        title: 'Keep momentum',
        description:
          'Bring decisions back into your documents, tasks, and team conversations.',
      },
    ],
  },
  folders: {
    title: 'Folders',
    steps: [
      {
        title: 'Give a project a home',
        description:
          'Group related work in a folder so it’s easy to find and return to.',
      },
      {
        title: 'Bring the pieces together',
        description:
          'Move items into folders and open them without losing the surrounding context.',
      },
      {
        title: 'Find what you need',
        description:
          'Use search and filters to narrow down the items in your workspace.',
      },
    ],
  },
};
