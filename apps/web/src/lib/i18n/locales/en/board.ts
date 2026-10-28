export default {
  // View
  title: 'Board',
  roleDescription: 'board',
  variantsNav: 'Board variants',
  variants: 'Variants',
  thisBoard: 'This board',

  // Variants
  v1aName: 'Neighborhoods',
  v1aDescription: 'Conversation cards clustered by where they happen',
  v1bName: 'Bubbles',
  v1bDescription: 'Faces with their latest message, loudest in the middle',
  v1cName: 'River',
  v1cDescription: 'Everything on one timeline, a lane per kind of work',
  v1dName: 'Radar',
  v1dDescription: 'What needs you sits closest to the center',
  v1eName: 'People',
  v1eDescription: 'Who is saying what, across every conversation',

  // Neighborhoods
  zoneChannels: 'Channels',
  zoneDms: 'Direct messages',
  zoneEmail: 'Email',
  zoneDocs: 'Docs & tasks',
  zoneAgents: 'Agents',
  zoneCalendar: 'Calendar',
  zoneCode: 'Pull requests',

  // People groups
  groupTeammates: 'Teammates',
  groupContacts: 'Outside contacts',
  groupAgents: 'Agents',
  roleTeammate: 'Teammate',
  roleAgent: 'Agent',

  // Radar rings
  ringNeedsYou: 'Needs you',
  ringNew: 'New',
  ringToday: 'Today',
  ringEarlier: 'Earlier',
  you: 'You',

  // River
  now: 'Now',

  // Items
  newCount: { one: '{{count}} new', other: '{{count}} new' },
  itemLabelUnread: {
    one: '{{title}}, {{count}} unread',
    other: '{{title}}, {{count}} unread',
  },
  itemLabelMoved: '{{label}}, moved by hand',
  updated: 'Updated',
  threadIn: 'Thread in #{{channel}}',
  live: 'Live',
  noMessages: 'No new messages',
  agentStarting: 'Starting',
  agentWorking: 'Working',
  agentWaiting: 'Waiting for you',
  pullRequestOpen: 'Open',
  pullRequestMerged: 'Merged',
  pullRequestClosed: 'Closed',

  // Controls
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomToFit: 'Zoom to fit',
  zoomLevel: 'Zoom level',
  boardZoom: 'Board zoom',
  showSettled: 'Show settled items',
  tidyUp: 'Tidy up',
  tidyUpDescription: 'Put moved items back in place',
  remove: 'Remove from board',
  removeItem: 'Remove {{title}} from board',
  openInSplit: 'Open in split',
  close: 'Close',
  showSettledCount: {
    one: 'Show {{count}} settled item',
    other: 'Show {{count}} settled items',
  },
  itemsOnBoard: { one: '{{count}} item', other: '{{count}} items' },
  unreadOnBoard: { one: '{{count}} unread', other: '{{count}} unread' },
  boardHelp:
    'Drag the board to pan, pinch or {{modifier}}-scroll to zoom. Drag cards to move them; read items settle and fade after a quiet spell.',

  // States
  loading: 'Loading the board…',
  error: 'The board could not load.',
  retry: 'Retry',
  emptyTitle: 'All caught up',
  emptyDescription: 'Nothing new is happening right now.',
};
