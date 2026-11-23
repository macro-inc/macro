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

  // The action and the entity are each marked, for the request card.
  createThing: '<em>create</em> <em>{{group}}</em>',
  readThing: '<em>read</em> <em>{{group}}</em>',
  updateThing: '<em>edit</em> <em>{{group}}</em>',
  destroyThing: '<em>delete</em> <em>{{group}}</em>',
  sendThing: '<em>send</em> <em>{{group}}</em>',
  useThing: '<em>use</em> <em>{{group}}</em>',
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
