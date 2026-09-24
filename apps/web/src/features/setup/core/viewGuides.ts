export type ViewGuideVideo = {
  youtubeId: string;
  title: string;
  duration: string;
};

export type ViewGuideStep = {
  title: string;
  description: string;
  /** Ordered selectors, scoped to the owning split. */
  targets: readonly string[];
  /** Only shared app chrome may be targeted outside the current split. */
  appTarget?: string;
  missingTarget?: string;
  revealCalendars?: boolean;
  agentPage?: 'new' | 'agent' | 'coder';
};

export type ViewGuide = {
  title: string;
  connector?: string;
  video?: ViewGuideVideo;
  steps: readonly ViewGuideStep[];
};

// Videos verified against Macro’s official YouTube channel on September 23, 2026.
export const VIEW_GUIDES: Record<string, ViewGuide> = {
  home: {
    video: {
      youtubeId: 'Fn5hdzXsQQ8',
      title: 'Macro Product Demo',
      duration: '4:45',
    },
    title: 'Home',
    steps: [
      {
        targets: ['[data-tour="home-list"]'],
        title: 'See your work together',
        description:
          'Home brings docs, DMs, emails, tasks, files, agents, and group chats into one place.',
      },
      {
        targets: ['[data-tour="home-filter"]'],
        title: 'Open the context',
        description:
          'Select an item to preview it beside your list. Use the filter to narrow what you see.',
      },
      {
        targets: [
          '[data-tour="home-composer"] [contenteditable="true"]',
          '[data-tour="home-composer"]',
        ],
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
        targets: ['[data-tour="calendar-sources"]'],
        missingTarget:
          'Connect your calendars, then open the calendar sidebar to choose which ones to show.',
        revealCalendars: true,
        title: 'All your calendars, one schedule',
        description:
          'Connect multiple Google accounts and see work, personal, and shared calendars together. Expand an account here to toggle individual calendars.',
      },
      {
        targets: ['[data-tour="calendar-availability"]'],
        missingTarget:
          'Connect a Google calendar to enable availability copying.',
        title: 'Copy your availability',
        description:
          'Choose a date range to copy your open times, then paste them into a message or email. Busy events across your connected calendars are taken into account.',
      },
      {
        targets: ['[data-tour="calendar-period"]'],
        title: 'Choose how you see your week',
        description:
          'Switch between day, week, and month. Move through dates without losing your connected calendars.',
      },
      {
        targets: ['[data-tour="calendar-grid"]'],
        title: 'Keep the conversation with the event',
        description:
          'Open an event to see its participants and meeting details. Join the call from the event when it is time.',
      },
    ],
  },
  inbox: {
    title: 'Inbox',
    steps: [
      {
        targets: ['[data-list-view]'],
        title: 'A home for what needs you',
        description:
          'Your inbox brings updates and notifications together so you can see what needs your attention.',
      },
      {
        targets: ['[data-soup-view]'],
        title: 'Open the context',
        description:
          'Open an item to see the conversation or document behind the update.',
      },
      {
        targets: ['[data-view-shell-top-bar]'],
        title: 'Make room for what’s next',
        description:
          'Mark handled items done. Use filters to focus on the work that matters now.',
      },
    ],
  },
  mail: {
    video: { youtubeId: 'tnsxkywzTvY', title: 'Macro Mail', duration: '1:24' },
    title: 'Email',
    connector: 'Google',
    steps: [
      {
        targets: ['[data-tour="email-signal-noise"]'],
        title: 'Find the signal in your inbox',
        description:
          'Signal keeps important conversations in focus. Noise gives lower-priority mail its own space, so you can catch up when it suits you.',
      },
      {
        targets: ['[data-tour="email-tags"]'],
        title: 'Organize email your way',
        description:
          'Create tags for projects, customers, or anything you track. Apply them manually, ask an agent to tag matching email, or set up an automation to keep it organized. Choose a tag here to see its messages.',
      },
      {
        targets: [
          '[role="grid"][aria-label="Email"]',
          'input[placeholder="Search email"]',
        ],
        title: 'Move faster with shortcuts',
        description:
          'Select messages and press ⌘K (Ctrl+K on Windows) to see available actions and their shortcuts. Use ⌘F / Ctrl+F to search email, and Escape to clear your selection.',
      },
    ],
  },
  documents: {
    video: { youtubeId: 'V8wE8Hq5_qw', title: 'Macro Docs', duration: '1:09' },
    title: 'Documents',
    connector: 'Notion',
    steps: [
      {
        targets: ['[data-view-shell-aside]', '[data-soup-view]'],
        title: 'A place for your ideas',
        description:
          'Create a document or bring your existing files into Macro. Search and filter to find them again.',
      },
      {
        targets: ['[contenteditable="true"]', '[data-view-shell-main]'],
        title: 'Connect the context',
        description:
          'In a document, type @ to mention people or link related work.',
      },
      {
        targets: ['[aria-label*="Share"]', '[data-view-shell-top-bar]'],
        title: 'Think together',
        description:
          'Share a document and use comments to keep feedback close to the work.',
      },
    ],
  },
  tasks: {
    video: { youtubeId: 'gxJquVXRX5A', title: 'Macro Tasks', duration: '1:35' },
    title: 'Tasks',
    connector: 'Linear',
    steps: [
      {
        targets: ['[data-view-shell-aside]', '[data-soup-view]'],
        title: 'Turn plans into progress',
        description:
          'Create a task with a clear next step, or connect Linear to bring your issues into Macro.',
      },
      {
        targets: ['[data-view-shell-main]'],
        title: 'Give work an owner',
        description:
          'Open a task to set its assignee, due date, and status. Add context so the next step is clear.',
      },
      {
        targets: ['[data-tour="tasks-tags"]'],
        missingTarget: 'Open the task sidebar to find your tags.',
        title: 'Keep tasks organized with tags',
        description:
          'Tag tasks by project, team, or type of work. Create and manage tags here, then select a tag to narrow your task list to what matters now.',
      },
    ],
  },
  channels: {
    video: {
      youtubeId: '1gDOXUxHo0U',
      title: 'What Macro learned from Slack/Superhuman',
      duration: '5:56',
    },
    title: 'Channels',
    steps: [
      {
        targets: ['[data-tour="channels-list"]'],
        title: 'Channels and DMs, together',
        description:
          'Organize work in shared channels, and use DMs for smaller conversations. All and Recent help you return to the right discussion.',
      },
      {
        targets: ['[data-tour="channels-create"]'],
        title: 'Bring your team into the room',
        description:
          'Use the + beside Channels to create a shared space, or the + beside DMs to start a direct message. Choose the people who need the context.',
      },
      {
        targets: ['[data-channel-message-list]'],
        missingTarget:
          'Select a channel or DM to see this feature highlighted.',
        title: 'Follow a thread, keep the context',
        description:
          'Open a conversation, then reply to a message in a thread. The discussion stays attached to the original message instead of getting lost in the channel.',
      },
      {
        targets: ['[contenteditable="true"]'],
        missingTarget:
          'Select a channel or DM to see this feature highlighted.',
        title: 'Bring agents and work into chat',
        description:
          'Type @ to mention a teammate or agent, or link a document, task, or call. Everyone in the conversation can follow the shared context they have access to.',
      },
      {
        targets: ['[data-tour="channel-call"]'],
        missingTarget:
          'Select a channel or DM to see this feature highlighted.',
        title: 'Go from messages to a call',
        description:
          'Use the phone button to start or join a call in this conversation. The call stays connected to the channel so the team can return to its context.',
      },
    ],
  },
  companies: {
    video: {
      youtubeId: '5d2K_NYs50k',
      title: 'Teams and CRM in Macro',
      duration: '2:33',
    },
    title: 'Customers',
    connector: 'HubSpot or Attio',
    steps: [
      {
        targets: ['[data-tour="crm-layout"]'],
        title: 'Your pipeline, as a board or list',
        description:
          'Switch to Board to see companies by stage, or List to scan their details in rows. Both show the same customer relationships—choose the view that fits your work.',
      },
      {
        targets: ['[data-view-shell-main]'],
        title: 'See the whole relationship',
        description:
          'Open a company to view its contacts and details. Update properties as the relationship develops.',
      },
      {
        targets: ['[aria-label="Company views"]'],
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
        targets: ['[data-tour="agent-picker"]'],
        agentPage: 'new',
        title: 'Choose your agent and model',
        description:
          'Open this picker to choose a chat or coding agent. Models are listed here too; each agent’s submenu lets you choose a model for that conversation.',
      },
      {
        targets: ['[data-tour="agent-team"]', '[data-tour="agent-roster"]'],
        agentPage: 'agent',
        title: 'Chat agents work with your context',
        description:
          'Chat agents use instructions and connected tools to research, write, and work with your documents and conversations. Your team and private agents live here.',
      },
      {
        targets: ['[data-tour="agent-team"]', '[data-tour="agent-roster"]'],
        agentPage: 'coder',
        title: 'Coding agents work on code',
        description:
          'Coding agents run through a coding runtime, such as Cursor or a paired machine. Choose a coding agent when you need repository work rather than a regular chat.',
      },
      {
        targets: ['[data-tour="agent-team"]'],
        agentPage: 'agent',
        title: 'Share agents with your team',
        description:
          'Team agents are available to teammates; private agents belong to you. When creating or editing an agent, choose Team or Private alongside its instructions and tools.',
      },
      {
        targets: ['[data-tour="agent-composer"]', '[data-tour="agent-picker"]'],
        agentPage: 'new',
        appTarget: '[data-tour="create-menu"]',
        title: 'Put recurring work on a schedule',
        description:
          'Use Create → Automation to give an agent instructions and a schedule—for example, a weekly summary or daily triage. Review the automation’s runs and pause it when you need to.',
      },
    ],
  },
  calls: {
    video: { youtubeId: 'MMG00RA7kU0', title: 'Macro Calls', duration: '1:15' },
    title: 'Calls',
    steps: [
      {
        targets: ['[data-soup-view]'],
        title: 'Pick up the conversation',
        description:
          'Find your recent calls here, alongside the work they relate to.',
      },
      {
        targets: ['[data-view-shell-main]'],
        title: 'Revisit the details',
        description:
          'Open a call to review its available transcript and catch up on what was discussed.',
      },
      {
        targets: ['[data-view-shell-aside]'],
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
        targets: ['[data-view-shell-aside]', '[data-soup-view]'],
        title: 'Give a project a home',
        description:
          'Group related work in a folder so it’s easy to find and return to.',
      },
      {
        targets: ['[data-view-shell-main]'],
        title: 'Bring the pieces together',
        description:
          'Move items into folders and open them without losing the surrounding context.',
      },
      {
        targets: ['input[placeholder*="Search"]', '[data-view-shell-top-bar]'],
        title: 'Find what you need',
        description:
          'Use search and filters to narrow down the items in your workspace.',
      },
    ],
  },
};
