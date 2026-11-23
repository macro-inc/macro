/**
 * Agent permissions in the agent chat: the approval a permission hold asks
 * for, a program the permissions blocked, and the card ShowPermissions puts
 * in the transcript.
 */
export default {
  theAgent: 'The agent',

  actionCreate: 'Create',
  actionRead: 'Read',
  actionUpdate: 'Update',
  actionDestroy: 'Delete',
  actionSend: 'Send',
  actionOther: 'Other',

  // What a held or refused program may do, as people say it: verbs, then
  // the entity they act on. The words the request card accents are marked.
  // `{{verbs}}` is one or more verbs joined as a list ("create, edit, and
  // delete").
  thing: '{{verbs}} {{entity}}',
  verbRead: 'read',
  verbCreate: 'create',
  verbUpdate: 'edit',
  verbSend: 'send',
  verbDestroy: 'delete',
  verbUse: 'use',
  entityDocuments: '<em>documents</em> and <em>projects</em>',
  entityTasks: '<em>tasks</em>',
  entityEmail: '<em>email</em>',
  entityCalendar: '<em>calendar events</em>',
  entityChannels: '<em>messages</em> in <em>channels</em>',
  entityChannelAdmin: '<em>channel settings</em> and <em>members</em>',
  entityCalls: '<em>calls</em> and <em>meetings</em>',
  entityExternalChats: '<em>outside chats</em>',
  entityContacts: '<em>contacts</em> in your <em>CRM</em>',
  entityDatabases: '<em>databases</em> and <em>forms</em>',
  entityRoutines: '<em>routines</em> and <em>reminders</em>',
  entityAi: '<em>AI chats</em> and <em>skills</em>',
  entityAgents: '<em>agent sessions</em>',
  entityConnections: '<em>connected apps</em> and <em>imports</em>',
  entitySharing: '<em>access</em> to your items',
  entitySearch: '<em>favorites</em> and <em>pins</em>',
  entityNotifications: '<em>notifications</em>',
  entityPasswords: '<em>passwords</em> and <em>API keys</em>',
  entityAccount: 'your <em>profile</em> and <em>team</em>',
  // Pairs whose tools a verb and the entity would misname.
  thingChannelAdminSend: '<em>change</em> <em>channels</em> and who is in them',
  thingChannelAdminDestroy: '<em>delete</em> <em>channels</em>',
  thingCallsSend:
    '<em>join</em> or <em>schedule</em> <em>calls</em> and <em>meetings</em>',
  thingEmailCreate: '<em>draft</em> <em>email</em>',
  thingChannelsCreate: '<em>start</em> <em>conversations</em>',
  thingExternalChatsSend:
    '<em>send</em> <em>messages</em> in <em>outside chats</em>',
  thingDocumentsSend: '<em>comment on</em> <em>documents</em>',
  thingCalendarSend: '<em>send</em> <em>calendar invitations</em>',
  thingSharingRead: '<em>see</em> who has <em>access</em> to your items',
  thingSharingUpdate: '<em>cancel</em> <em>access requests</em>',
  thingSharingSend: '<em>change</em> who has <em>access</em> to your items',
  thingSearchRead: '<em>search</em> your <em>workspace</em>',
  thingSearchCreate: '<em>add</em> <em>favorites</em> and <em>pins</em>',
  thingSearchUpdate: '<em>change</em> <em>favorites</em> and <em>pins</em>',
  thingSearchSend: '<em>preview</em> <em>links</em>',
  thingAccountCreate: '<em>upload</em> a <em>profile picture</em>',
  thingAccountSend: '<em>invite</em> people to your <em>team</em>',
  thingAccountDestroy: '<em>delete</em> <em>team invites</em>',
  thingConnectionsSend: '<em>use</em> <em>connected apps</em>',
  thingAiSend: '<em>search</em> the <em>web</em>',
  thingRoutinesSend: '<em>share</em> <em>routine templates</em>',
  // A group this build doesn't know, by its name.
  entityOther: '<em>{{group}}</em>',
  moreThings: { one: '{{count}} more thing', other: '{{count}} more things' },

  approvalLabel: 'Permission approval request',
  allowRequest: 'Allow {{agent}} to {{things}}?',
  allowRun: 'Allow {{agent}} to run a program?',
  waitingFor: 'Waiting for {{name}} to approve',
  wantsToWithAccess: '{{agent}} wants to {{things}} with {{name}}’s access.',
  wantsToRunWithAccess:
    '{{agent}} wants to run a program with {{name}}’s access.',
  theApprover: 'the person it acts for',
  deny: 'Deny',
  editPermissions: 'Edit permissions',
  allowOnce: 'Allow once',
  allowInSession: 'Allow in this session',
  cancelRequest: 'Cancel request',
  viewProgram: 'View program',
  hideProgram: 'Hide program',
  programPart: 'Program',
  modulePart: 'Module, with no network',

  runProgram: 'Run a program',
  denied: 'Denied',
  cancelled: 'Cancelled',
  notApprovedInTime: 'Not approved in time',

  operationsLabel: 'Operations',
  showMoreOperations: { other: 'Show {{count}} more' },
  showFewerOperations: 'Show fewer',

  blockedTitle: 'Blocked by permissions',
  blockedBody:
    'Nothing ran. This program could {{things}}, and {{agent}} is never allowed to.',
  blockedTold: '{{agent}} was told it can’t do this.',
  blockedReadOnly: 'Only people who can edit {{agent}} can change this.',
  reviewPermissions: 'Review permissions',
  blockedStep: 'Blocked',

  showingPermissions: 'Showing permissions',
  showPermissions: 'Show permissions',
  cardTitle: '{{agent}}’s permissions',
  cardBody: '{{agent}} asked you to look at these.',
  allPermissions: 'All permissions',
  cardSaves: 'Changes save right away and apply to {{agent}} everywhere.',
  cardReadOnly: 'Only people who can edit {{agent}} can change these.',
  cardUnavailable: 'Permissions aren’t available here.',
  cardLoadFailed: 'Couldn’t load these permissions.',
  tryAgain: 'Try again',
  loading: 'Loading permissions',
};
