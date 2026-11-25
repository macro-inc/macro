export default {
  // Top navigation lenses
  lensBrowse: 'All',
  lensFocus: 'Focus',
  lensSupport: 'Support',
  lensThreads: 'Threads',
  lensNavLabel: 'Chat views',

  // Header & global controls
  quickSwitchPlaceholder: 'Jump to channel or person…',
  quickSwitchTooltip: 'Quick switch (⌘J)',
  unreadOnlyTooltip: 'Show unread only (⌘⇧U)',
  unreadOnlyActive: 'Unread only',
  viewOptionsTooltip: 'Sidebar view options',
  organizeWithJev: 'Smart organize with Jev…',
  hideMutedChannels: 'Hide muted channels',
  showMutedChannels: 'Show muted channels',
  jevTriageToggle: 'Jev smart triage',
  jevTriageDescription:
    'Classify support urgency, resolved replies, and FYI noise',
  jevEngineActive: 'Jev',
  jevEngineHeuristic: 'Smart rules',
  jevEnginePaused: 'Paused',
  refreshTriage: 'Refresh triage',
  manageHiddenSections: 'Hidden team sections',
  hiddenSectionsCount: {
    one: '{{count}} hidden team section',
    other: '{{count}} hidden team sections',
  },
  showHiddenSection: 'Show in my sidebar',
  hideSectionForMe: 'Hide from my sidebar',
  hideSectionForMeHint: 'Hidden only for you — teammates still see it',
  restoreAllHidden: 'Restore all',

  // Spatial map zones
  pinnedHeading: 'Pinned',
  personalZone: 'Personal',
  teamZone: '{{name}}',
  teamZoneFallback: 'Team',
  ungroupedChannels: 'Channels',
  browseUnjoined: 'Browse channels',
  newPersonalSection: 'New personal section',
  newTeamSection: 'New team section',

  // Direct messages smart window
  dmHeading: 'Direct messages',
  dmFilterAll: 'All',
  dmFilterPeople: 'People',
  dmFilterAgents: 'Agents',
  dmFilterPlaceholder: 'Filter DMs…',
  dmWindowSize: 'Visible recent DMs',
  dmWindowOption: {
    one: 'Top {{count}} recent',
    other: 'Top {{count}} recent',
  },
  dmWindowAll: 'Show all',
  dmShowMore: {
    one: 'Show {{count}} more DM',
    other: 'Show {{count}} more DMs',
  },
  dmShowLess: 'Show fewer DMs',
  dmEmptyPeople: 'No people DMs match',
  dmEmptyAgents: 'No agent DMs yet',
  dmAgentBadge: 'Agent',

  // Large section smart density
  sectionShowMore: {
    one: 'Show {{count}} more',
    other: 'Show {{count}} more',
  },
  sectionShowLess: 'Show fewer',
  openSupportDesk: 'Open triage',

  // Focus lens ("Needs you")
  focusTitle: 'Focus',
  focusSubtitle: 'What needs you right now',
  focusAllClearTitle: 'All caught up',
  focusAllClearDescription:
    'No unread mentions, direct asks, or support channels waiting on you.',
  focusBucketDirect: 'Direct & @mentions',
  focusBucketSupport: 'Support waiting',
  focusBucketUnread: 'Active unreads',
  focusBucketFyi: 'Automated & FYI',
  focusSweepRead: 'Mark all read',
  focusMarkRead: 'Mark read',
  focusMute: 'Mute',
  focusUrgentTag: 'Urgent',
  focusNeedsReplyTag: 'Needs reply',
  focusMentionedTag: 'Mentioned',
  focusAgentTag: 'Agent update',
  focusFyiTag: 'FYI',
  focusWaitingTag: 'Waiting {{age}}',

  // Support Desk lens
  supportTitle: 'Support Desk',
  supportFilterPlaceholder: 'Filter customers…',
  supportBucketNeedsReply: 'Needs reply',
  supportBucketAgentHandling: 'Agent handling',
  supportBucketWaitingCustomer: 'Waiting on customer',
  supportBucketResolved: 'Quiet & resolved',
  supportWaitingSummary: {
    one: '{{count}} waiting',
    other: '{{count}} waiting',
  },
  supportUrgentSummary: {
    one: '{{count}} urgent',
    other: '{{count}} urgent',
  },
  supportAllHandledTitle: 'Every customer is answered',
  supportAllHandledDescription:
    'No support channels are currently waiting on your team.',
  supportEmptySearch: 'No support channels match “{{query}}”',
  supportStateUrgent: 'Urgent',
  supportStateNeedsReply: 'Needs reply',
  supportStateAgent: 'Agent replied',
  supportStateWaiting: 'Waiting on customer',
  supportStateResolved: 'Resolved',
  supportSenderYou: 'You',
  supportSenderTeam: 'Team',
  supportSenderAgent: 'Agent',
  supportSenderCustomer: 'Customer',

  // Quick Switcher
  quickSwitchTitle: 'Jump to conversation',
  quickSwitchGroupUnread: 'Unread & mentions',
  quickSwitchGroupJoined: 'Your conversations',
  quickSwitchGroupSections: 'Sections & views',
  quickSwitchGroupDiscover: 'Join team channels',
  quickSwitchHint: '↑↓ navigate · ↵ open · ⇧↵ split · Esc close',
  quickSwitchNoMatches: 'No channels or people match “{{query}}”',

  // Smart Organize with Jev dialog
  organizeTitle: 'Smart organize with Jev',
  organizeDescription:
    'Review suggested placements for your ungrouped channels. Nothing changes until you apply.',
  organizeAnalyzing: 'Analyzing ungrouped channels…',
  organizeEmpty: 'Your channels are already neatly organized.',
  organizeApply: {
    one: 'Move {{count}} channel',
    other: 'Move {{count}} channels',
  },
  organizeApplying: 'Organizing…',
  organizeApplied: {
    one: 'Organized {{count}} channel',
    other: 'Organized {{count}} channels',
  },
  organizeFailed: 'Could not organize some channels. Please try again.',
  organizeProposedSection: 'New section: {{name}}',
  organizeExistingSection: 'Move to {{name}}',
  organizeJevCostNote: 'Classified {{count}} channels (~{{cost}})',

  // Context menu actions
  contextOpenInSplit: 'Open in new split',
  contextPinToTop: 'Pin to top',
  contextUnpinFromTop: 'Unpin from Pinned',
  contextMuteChannel: 'Mute channel',
  contextUnmuteChannel: 'Unmute channel',

  // Keyboard footer hints
  footerHintJump: 'sections',
  footerHintSwitch: 'jump',
};
