export default {
  title: 'Notifications',
  description:
    "Choose when you'll be notified. Inbox items always arrive unless you mute a type or an item.",

  // Delivery
  delivery: 'Delivery',
  inbox: 'Inbox',
  inboxDescription: 'Always on for types you have not muted',
  alwaysOn: 'Always on',
  mobilePush: 'Mobile notifications',
  mobilePushDescription: 'Receive push notifications on this device',
  desktopPush: 'Desktop notifications',
  desktopPushDescription:
    'Receive notifications on this browser or desktop app',
  pushUnsupported: 'Not supported on this device',
  emailDigest: 'Email digest',
  emailDigestDescription:
    'A periodic email of unread notifications. Inbox items are unchanged.',
  pushUpdateFailed: 'Could not update notifications. Try again.',
  preferenceUpdateFailed: 'Could not update notification preference',
  blockedMacos:
    'Open System Settings → Notifications → Macro and turn on Allow notifications.',
  blocked: 'Allow notification permissions, then try again.',

  // Notification types, by group
  groupSharing: 'Sharing',
  eventEntityAccessRequested: 'Permission requests',
  eventEntityAccessRequestedDescription:
    'Requests for more access to items you manage',
  eventEntityAccessGranted: 'Access granted',
  eventEntityAccessGrantedDescription: 'When a permission request is approved',
  groupChannels: 'Channels',
  eventChannelMessageSend: 'New messages',
  eventChannelMessageSendDescription: 'Messages in channels you belong to',
  eventChannelMention: 'Mentions',
  eventChannelMentionDescription: 'When someone mentions you in a channel',
  eventChannelMessageReply: 'Thread replies',
  eventChannelMessageReplyDescription: 'Replies in threads you are part of',
  eventChannelMessageReaction: 'Message reactions',
  eventChannelMessageReactionDescription:
    'When someone reacts to one of your messages',
  eventChannelAccessRequested: 'Requests to join',
  eventChannelAccessRequestedDescription:
    'When someone asks to join a channel you belong to',
  groupDocuments: 'Documents',
  eventDocumentMention: 'Document mentions',
  eventDocumentMentionDescription: 'When a document is mentioned in a channel',
  eventMentionedInDocumentComment: 'Comment mentions',
  eventMentionedInDocumentCommentDescription:
    'When you are mentioned in a document comment',
  eventRepliedToDocumentCommentThread: 'Comment replies',
  eventRepliedToDocumentCommentThreadDescription:
    'Replies on comment threads you are part of',
  eventCommentedOnDocument: 'New comments',
  eventCommentedOnDocumentDescription: 'Comments on documents you own',
  groupProjects: 'Projects',
  eventInitiativeDiscussion: 'Discussion',
  eventInitiativeDiscussionDescription:
    'Mentions, replies, and comments on projects you own or are assigned to',
  groupCrm: 'Companies & contacts',
  eventCrmDiscussion: 'Discussion',
  eventCrmDiscussionDescription:
    'Mentions, replies, and comments on companies you own and their contacts',
  groupTasks: 'Tasks',
  eventTaskAssigned: 'Assignments',
  eventTaskAssignedDescription: 'When a task is assigned to you',
  groupCalendar: 'Calendar',
  eventCalendarEventReminder: 'Event reminders',
  eventCalendarEventReminderDescription:
    'When a calendar event is about to start',
  eventCalendarEventJoinRequest: 'Requests to join',
  eventCalendarEventJoinRequestDescription:
    'When someone asks to be added to an event you shared in a channel',
  groupEmail: 'Email',
  eventNewEmail: 'New email',
  eventNewEmailDescription: 'When a new email arrives',
  groupAi: 'AI',
  eventAiResponse: 'AI replies',
  eventAiResponseDescription: 'When an AI chat responds',
  eventAgentSessionSettled: 'Agent finished',
  eventAgentSessionSettledDescription:
    'When an agent session you took part in finishes a turn',
  eventAgentSessionWaitingForInput: 'Agent needs an answer',
  eventAgentSessionWaitingForInputDescription:
    'When your agent stops to ask you something',
  eventAgentSessionMentioned: 'Agent session mentions',
  eventAgentSessionMentionedDescription:
    'When someone mentions you in an agent session',
  eventRoutineRunFinished: 'Routine runs',
  eventRoutineRunFinishedDescription:
    'When one of your routines finishes or fails a run',
  eventAgentSignInExpiry: 'Computer agent sign-ins',
  eventAgentSignInExpiryDescription:
    "When an agent sign-in on your team's computer is about to expire",
  eventComputerSetup: 'Computer setup',
  eventComputerSetupDescription:
    'When a computer you bought is ready, or could not be set up',
  groupGithub: 'GitHub',
  eventGithubPrStatusChanged: 'PR status',
  eventGithubPrStatusChangedDescription:
    'When a pull request changes lifecycle state',
  eventGithubReviewRequested: 'Review requested',
  eventGithubReviewRequestedDescription: 'When your review is requested',
  eventGithubPrComment: 'PR comments',
  eventGithubPrCommentDescription: 'When someone comments on a pull request',
  eventGithubPrMention: 'PR mentions',
  eventGithubPrMentionDescription: 'When you are mentioned on a pull request',
  eventGithubPrReview: 'PR reviews',
  eventGithubPrReviewDescription:
    'When a review is submitted on your pull request',

  // Snoozed and muted items
  snoozedTitle: 'Snoozed items',
  snoozedDescription:
    'Notifications pause until the time you choose. Items stay visible in your inbox.',
  snoozedLoadFailed: 'Could not load snoozed items',
  retry: 'Retry',
  snoozedLoading: 'Loading snoozed items…',
  snoozedEmpty: 'Nothing snoozed',
  snoozedEmptyDescription:
    'Right-click an item or use the command menu and choose Snooze notifications.',
  mutedTitle: 'Muted items',
  mutedDescription: 'These items will not send you notifications.',
  mutedEmpty: 'Nothing muted',
  mutedEmptyDescription: 'Items you mute stop sending notifications.',
  snoozedUntil: 'Until {{time}}',
  changeTime: 'Change time',
  snoozeInstead: 'Snooze instead',
  resume: 'Resume',
  unmute: 'Unmute',
  unmuteFailed: 'Could not unmute item',

  // What a muted item is, when its name is unknown
  entityCalendarEvent: 'Calendar event',
  entityCall: 'Call',
  entityChannel: 'Channel',
  entityThread: 'Thread',
  entityChat: 'Chat',
  entityDocument: 'Document',
  entityEmail: 'Email',
  entityGithub: 'GitHub',
  entityFolder: 'Folder',
  entityProject: 'Project',
  entityCompany: 'Company',
  entityContact: 'Contact',
  entityReminder: 'Reminder',
  entityTeam: 'Team',
};
