export default {
  // Navigation and list
  title: 'Sequences',
  navigation: 'Sequences navigation',
  loading: 'Loading sequences',
  loadFailed: 'Couldn’t load sequences',
  unavailable: 'This sequence isn’t available',
  retry: 'Retry',
  search: 'Search sequences',
  newSequence: 'New sequence',
  newSequenceHint:
    'Write a few emails that go out one after another from your Gmail inbox.',
  create: 'Create',
  untitled: 'Untitled sequence',
  noSequences: 'No sequences yet',
  noSequencesHint:
    'Create a sequence, write its emails, and enroll people from Customers.',
  noMatchingSequences: 'No matching sequences',
  noMatchingSequencesHint: 'Try another search.',
  emailCount: { one: '{{count}} email', other: '{{count}} emails' },
  activeCount: { one: '{{count}} active', other: '{{count}} active' },
  needAttentionCount: {
    one: '{{count}} needs attention',
    other: '{{count}} need attention',
  },
  addToSequence: 'Add to sequence',

  // Sequence statuses
  statusDraft: 'Draft',
  statusActive: 'Active',
  statusPaused: 'Paused',

  // Sequence detail
  allSequences: 'All sequences',
  views: 'Sequence views',
  steps: 'Emails',
  people: 'People',
  save: 'Save',
  activate: 'Activate',
  pauseSequence: 'Pause',
  resumeSequence: 'Resume',
  enrollPeople: 'Enroll people',
  reload: 'Reload',
  unsavedChanges: 'Unsaved changes',
  discardChanges: 'Discard',
  draftHint:
    'Activate the sequence to start enrolling people. Each person gets these emails with their own details filled in.',
  pauseToEdit:
    'Pause the sequence to edit it. People keep getting the emails they were enrolled with.',
  editsApplyToNew:
    'Edits apply to people you enroll after saving. People already enrolled keep the emails they were enrolled with.',
  connectGmail:
    'Connect a Gmail inbox of your own to send sequences. Shared inboxes and Outlook can’t send them.',
  noticeSaved: 'Sequence saved',
  noticeActivated: 'Sequence activated',
  noticePaused: 'Sequence paused',
  noticeDeleted: 'Sequence deleted',
  deleteTitle: 'Delete “{{name}}”?',
  deleteBody:
    'Emails not sent yet are canceled. Unsubscribe links in emails already sent keep working.',

  // Editor
  name: 'Name',
  sendFrom: 'Send from',
  chooseInbox: 'Choose an inbox',
  noInbox: 'No Gmail inbox connected',
  inboxNeedsReconnect: '{{email}} (reconnect to send)',
  starts: 'Sequence starts',
  startsHint:
    'When you enroll someone, the first email goes out at the start time you pick.',
  emailNumber: 'Email {{position}}',
  moveUp: 'Move up',
  moveEmailUp: 'Move email {{position}} up',
  remove: 'Remove',
  removeEmail: 'Remove email {{position}}',
  delayDays: 'Days before email {{position}}',
  delayAfterStart: 'Days after the start',
  delayAfterPrevious: 'Days after the previous email',
  replyInThread: 'Send as a reply in the same thread',
  subject: 'Subject',
  subjectOf: 'Subject of email {{position}}',
  subjectPlaceholder: 'Subject',
  message: 'Message',
  messageOf: 'Message of email {{position}}',
  messagePlaceholder: 'Hi {{token}},',
  personalizeHint: 'Personalize with {{tokens}}.',
  addEmail: 'Add email',
  ends: 'Sequence ends',
  endsHint: 'It also stops for anyone who replies, bounces, or unsubscribes.',
  footer: 'Footer',
  footerPlaceholder: 'A line under every email, such as your company address',
  footerHint: 'An unsubscribe link is added below it.',

  // Enrollments
  peopleHint:
    'Each person gets the emails as they were when enrolled. Open a row to see them.',
  noEnrollments: 'No one is enrolled yet',
  noEnrollmentsHint: 'Enroll people from Customers to start sending.',
  activateToEnroll: 'Activate the sequence to enroll people.',
  enrollmentActive: 'Active',
  enrollmentPaused: 'Paused',
  enrollmentNeedsAttention: 'Needs attention',
  enrollmentStopped: 'Stopped',
  enrollmentCompleted: 'Completed',
  statusWithReason: '{{status}} · {{reason}}',
  reasonManual: 'By you',
  reasonReplied: 'Replied',
  reasonBounced: 'Bounced',
  reasonUnsubscribed: 'Unsubscribed',
  reasonAccessLost: 'Access lost',
  reasonInboxUnavailable: 'Inbox unavailable',
  reasonStepFailed: 'Send failed',
  reasonStepWithdrawn: 'Email removed',
  reasonStepUnknown: 'Send unconfirmed',
  reasonStepStuck: 'Not sent yet',
  reasonManualDetail: 'You stopped this enrollment.',
  reasonRepliedDetail:
    'They replied, so no more emails go out. Resume if the reply shouldn’t end the sequence.',
  reasonBouncedDetail:
    'The email couldn’t be delivered to this address. Resume to try again.',
  reasonUnsubscribedDetail:
    'They unsubscribed from your team’s sequences, so no more emails go out.',
  reasonAccessLostDetail:
    'The sequence’s owner left the team, or the team turned off Customers.',
  reasonInboxUnavailableDetail:
    'The sending inbox is disconnected or needs to be reconnected. Reconnect it, then resume.',
  reasonStepFailedDetail:
    'Gmail refused the email after several tries. Retry to send it again.',
  reasonStepWithdrawnDetail:
    'The email was removed from Mail before it went out. Retry to schedule it again.',
  reasonStepUnknownDetail:
    'The email may have gone out, so it won’t be sent again. Resume to continue with the next one.',
  reasonStepStuckDetail:
    'The email still hasn’t gone out well after its send time. Resume to try it again.',
  showSteps: 'Show emails',
  stepProgress: '{{done}} of {{total}} sent',
  lastSent: 'Last sent {{time}}',
  nextSend: 'Next {{time}}',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  unsubscribe: 'Unsubscribe',
  unsubscribed: 'Unsubscribed',
  unsubscribeTitle: 'Unsubscribe {{email}}?',
  unsubscribeBody:
    'They stop getting every sequence from anyone on your team, and can’t be enrolled again.',
  loadingSteps: 'Loading emails',
  stepsLoadFailed: 'Couldn’t load the emails.',
  stepPending: 'Not scheduled yet',
  stepScheduled: 'Sends {{time}}',
  stepSent: 'Sent {{time}}',
  stepSentUndated: 'Sent',
  stepUnknown: 'May have been sent',

  // Enrolling
  enrollTitle: 'Enroll people',
  enrollInto: 'Into {{name}}',
  sequence: 'Sequence',
  chooseSequence: 'Choose a sequence',
  noActiveSequences: 'Activate a sequence first to enroll people.',
  searchPeople: 'Search people',
  searchPeoplePlaceholder: 'Search people in Customers',
  loadingPeople: 'Loading people',
  peopleLoadFailed: 'Couldn’t load people.',
  noMatchingPeople: 'No matching people',
  noEmail: 'No email address',
  startSending: 'Start sending',
  startHint:
    'Later emails go out at the same time of day in your time zone, after each wait.',
  consent: 'These people agreed to receive email from me.',
  selectedCount: { other: '{{count}} of {{max}} selected' },
  enrollCount: { one: 'Enroll {{count}}', other: 'Enroll {{count}}' },
  enrolledCount: {
    one: 'Enrolled {{count}} person',
    other: 'Enrolled {{count}} people',
  },
  skippedCount: {
    one: '{{count}} person was skipped:',
    other: '{{count}} people were skipped:',
  },
  done: 'Done',
  skipNotFound: 'Not in your team’s Customers',
  skipNoEmail: 'No email address',
  skipInvalidEmail: 'Invalid email address',
  skipUnsubscribed: 'Unsubscribed',
  skipAlreadyEnrolled: 'Already in this sequence',
  skipUnknown: 'Skipped',

  // Errors
  errorUnavailable: 'Couldn’t reach Macro. Try again.',
  errorNotFound: 'This sequence no longer exists, or it isn’t yours.',
  errorVersionConflict:
    'This sequence changed elsewhere. Reload to see the latest version.',
  errorInvalidTransition: 'The sequence can’t change to that status now.',
  errorInvalidSequence: 'The sequence isn’t ready to send yet.',
  errorSequenceNotActive: 'Activate the sequence before enrolling people.',
  errorTooManyContacts: 'Enroll up to {{max}} people at a time.',
  errorInvalidStart: 'Choose a valid start time.',
  errorInvalidTimezone: 'Your time zone wasn’t recognized.',
  errorActionUnavailable: 'That action isn’t available for this person now.',
  errorStepInDelivery:
    'An email to this person is being sent right now. Try again in a minute.',
  errorNoTeam: 'Sequences need a team with Customers turned on.',
  errorCrmDisabled: 'Turn on Customers for your team to use sequences.',
  errorInternal: 'Something went wrong. Try again.',
  problemNameRequired: 'Give the sequence a name.',
  problemNameTooLong: 'Use a name of up to {{max}} characters.',
  problemFooterTooLong: 'Use a footer of up to {{max}} characters.',
  problemStepsRequired: 'Add at least one email.',
  problemTooManySteps: 'A sequence can have up to {{max}} emails.',
  problemFirstStepIsReply: 'The first email can’t be a reply.',
  problemSubjectRequired: 'Email {{position}} needs a subject.',
  problemSubjectSingleLine:
    'The subject of email {{position}} must be one line.',
  problemSubjectTooLong:
    'The subject of email {{position}} is longer than {{max}} characters.',
  problemBodyRequired: 'Email {{position}} needs a message.',
  problemBodyTooLong:
    'The message of email {{position}} is longer than {{max}} characters.',
  problemDelayRange: 'Email {{position}} must wait 0 to {{max}} days.',
  problemUnknownToken:
    'Remove personalization Macro can’t fill in: {{tokens}}.',
  problemSenderRequired: 'Choose an inbox to send from.',
  problemSenderUnavailable:
    'The sending inbox is disconnected or needs to be reconnected.',
};
