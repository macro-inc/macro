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

  createThing: 'create {{group}}',
  readThing: 'read {{group}}',
  updateThing: 'edit {{group}}',
  destroyThing: 'delete {{group}}',
  sendThing: 'send {{group}}',
  useThing: 'use {{group}}',
  moreThings: { one: '{{count}} more thing', other: '{{count}} more things' },
  runProgram: 'run a program that may {{things}}',
  runProgramTitle: 'Run a program that may {{things}}',

  approvalLabel: 'Permission approval request',
  approvalNeeded: 'Approval needed',
  waitingFor: 'Waiting for {{name}} to approve',
  wantsToRun: '{{agent}} wants to run a program that may:',
  wantsToRunAs:
    "{{agent}} wants to run a program with {{name}}'s access that may:",
  approverNote:
    'These are set to Ask in <link>{{agent}}’s permissions</link>. A program may not reach every call listed. Allow for this session skips asking for these until the session ends.',
  waitingNote:
    '{{name}} answers this. You can stop waiting, which declines it.',
  waitingNoteOnly: '{{name}} answers this.',
  viewProgram: 'View program',
  hideProgram: 'Hide program',
  decline: 'Decline',
  allowForSession: 'Allow for this session',
  approve: 'Approve',
  cancel: 'Cancel',
  theApprover: 'the person it acts for',

  allowedForSessionBy: 'Allowed for this session by {{name}}',
  allowedForSession: 'Allowed for this session',
  approvedBy: 'Approved by {{name}}',
  approved: 'Approved',
  declinedBy: 'Declined by {{name}}',
  declined: 'Declined',
  cancelledBy: 'Cancelled by {{name}}',
  cancelled: 'Cancelled',
  notApprovedInTime: 'Not approved in time',
  you: 'you',

  operationsLabel: 'Operations',
  showMoreOperations: { other: 'Show {{count}} more' },
  showFewerOperations: 'Show fewer',

  blockedTitle: 'Blocked by permissions',
  blockedBody:
    'Nothing ran. This program could {{things}}, and {{agent}} is never allowed to.',
  blockedTold: '{{agent}} was told it can’t do this.',
  blockedReadOnly: 'Only people who can edit {{agent}} can change this.',
  reviewPermissions: 'Review permissions',
  didntRun: 'Didn’t run a program that may {{things}}',
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
