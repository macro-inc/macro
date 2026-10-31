export default {
  // Navigation and sections
  navigation: 'Email Marketing navigation',
  campaigns: 'Campaigns',
  contacts: 'Contacts',
  unsubscribedSection: 'Unsubscribed',
  delivery: 'Delivery',
  loading: 'Loading Email Marketing',
  loadFailed: 'Couldn’t load Email Marketing',
  refresh: 'Refresh',
  close: 'Close',
  cancel: 'Cancel',

  // Campaign list
  newCampaign: 'New campaign',
  searchCampaigns: 'Search campaigns',
  filterAll: 'All',
  filterStatus: 'Filter by status',
  noCampaigns: 'No campaigns yet',
  noCampaignsHint:
    'Create a campaign, write a sequence, and enroll your contacts.',
  noMatchingCampaigns: 'No matching campaigns',
  noMatchingCampaignsHint: 'Try another search or status.',
  emailCount: { one: '{{count}} email', other: '{{count}} emails' },
  enrolledCount: { one: '{{count}} enrolled', other: '{{count}} enrolled' },
  needAttentionCount: {
    one: '{{count}} needs attention',
    other: '{{count}} need attention',
  },

  // Statuses
  statusDraft: 'Draft',
  statusActive: 'Active',
  statusPaused: 'Paused',
  statusPreparing: 'Preparing',
  statusScheduled: 'Scheduled',
  statusStopped: 'Stopped',
  statusNeedsAttention: 'Needs attention',
  statusCompleted: 'Completed',
  unsubscribed: 'Unsubscribed',

  // Delivery problems
  attentionStalled: 'Not sent yet',
  attentionFailed: 'Send failed',
  attentionUnconfirmed: 'Send unconfirmed',
  attentionMissing: 'No longer scheduled',
  attentionDisconnected: 'Inbox disconnected',
  attentionInterrupted: 'Scheduling interrupted',
  attentionStalledDetail:
    'Still waiting well after its send time. Open the email to check it.',
  attentionFailedDetail:
    'Gmail rejected this email, often for a sending limit, and won’t retry it. Open the email to send it again.',
  attentionUnconfirmedDetail:
    'Gmail may or may not have sent this email. Check your Sent folder before sending it again.',
  attentionMissingDetail:
    'This email was deleted or sent outside Email Marketing, so it’s no longer scheduled.',
  attentionInterruptedDetail:
    'Scheduling stopped before every email was set up. Pause and resume to finish it, or stop it.',
  attentionDisconnectedDetail:
    'This inbox is no longer connected, so its scheduled emails were canceled. Reconnect it and choose it on the campaign.',

  // Create campaign
  createCampaign: 'Create campaign',
  createCampaignHint: 'Start with a sequence that sounds like you.',
  campaignName: 'Campaign name',
  startingPoint: 'Starting point',
  templateWelcome: 'Welcome series · 2 emails',
  templateBlank: 'Blank sequence',
  welcomeSubject: 'Welcome, {{tag}}',
  welcomeBody:
    'Hi {{tag}},\n\nThanks for joining us. I’m glad you’re here.\n\nWhat are you hoping to get out of it? Just reply. I’d love to hear.',
  welcomeFollowUpBody:
    'Hi {{tag}},\n\nChecking in to see how things are going. If you have any questions, reply and I’ll help you get started.',

  // Campaign detail
  allCampaigns: 'All campaigns',
  campaignViews: 'Campaign views',
  sequence: 'Sequence',
  enrollments: 'Enrollments',
  delete: 'Delete',
  saveDraft: 'Save draft',
  activate: 'Activate',
  pauseCampaign: 'Pause campaign',
  enrollContacts: 'Enroll contacts',
  unsavedChanges: 'Unsaved changes',
  changedElsewhereNotice:
    'This campaign changed in another tab or device since you started editing.',
  discardChanges: 'Discard my changes',
  pauseToEdit:
    'Pause this campaign to edit it. Existing enrollments keep the emails they were enrolled with.',
  reconnectBeforeEnrolling:
    'Reconnect this Gmail inbox in Settings before enrolling.',
  deleteTitle: 'Delete {{name}}?',
  deleteBody:
    'This stops every enrollment and cancels emails that haven’t been sent, then deletes the campaign and its records. Emails already sent stay in your Sent folder.',

  // Sequence editor
  sendFrom: 'Send from',
  chooseInbox: 'Choose a Gmail inbox',
  inboxNeedsReconnect: '{{email}} · reconnect required',
  description: 'Description',
  descriptionOptional: 'Description (optional)',
  descriptionPlaceholder: 'What does this sequence help people do?',
  sequenceStarts: 'Contact is enrolled',
  sequenceStartsHint: 'Choose contacts and a start time when you enroll them.',
  emailNumber: 'Email {{position}}',
  preview: 'Preview',
  moveUp: 'Move up',
  moveEmailUp: 'Move email {{position}} up',
  remove: 'Remove',
  removeEmail: 'Remove email {{position}}',
  wait: 'Wait',
  delayDays: 'Email {{position}} delay in days',
  daysAfterStart: {
    one: 'day after enrollment starts',
    other: 'days after enrollment starts',
  },
  daysAfterPrevious: {
    one: 'day after the previous email',
    other: 'days after the previous email',
  },
  replyInThread: 'Send as a reply in the same thread',
  subject: 'Subject',
  subjectOf: 'Email {{position}} subject',
  subjectPlaceholder: 'A subject worth opening',
  message: 'Message',
  messageOf: 'Email {{position}} message',
  messagePlaceholder: 'Hi {{tag}},',
  personalizeHint: 'Plain-text email. Personalize with {{tags}}.',
  addEmail: 'Add email',
  sequenceEnds: 'Sequence ends',
  sequenceEndsHint:
    'Replies come to your inbox. Mark people unsubscribed when they ask.',
  optOutLine: 'Opt-out line added to every email',
  defaultOptOutLine:
    'If you would prefer not to receive these emails, reply "unsubscribe".',

  // Preview
  emailPreview: 'Email preview',
  emailPreviewHint: 'The personalized email your contact receives.',
  previewContact: 'Preview contact',
  sampleContact: '{{name}} · sample contact',
  previewTo: 'To: {{email}}',

  // Enrollments
  peopleInSequence: 'People in this sequence',
  peopleInSequenceHint:
    'Pausing or stopping cancels upcoming emails. Sent emails can’t be recalled.',
  noEnrollments: 'No one is enrolled yet',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  markUnsubscribed: 'Mark unsubscribed',
  openEmail: 'Open email',
  stepLine: '{{position}}. {{subject}}',
  stepAt: '{{time}} · {{state}}',
  stepPending: 'Not scheduled',
  stepScheduling: 'Scheduling',
  stepScheduled: 'Scheduled',
  stepDue: 'Due',
  stepCanceled: 'Canceled',
  stepSent: 'Sending or sent',
  statusNotReceipt:
    'Scheduled and due aren’t delivery receipts. Check your Sent folder to confirm delivery.',

  // Enroll dialog
  enrollInto: 'Add people to {{name}}.',
  searchContacts: 'Search contacts',
  searchContactsPlaceholder: 'Search contacts by name or email',
  searchCrm: 'Search CRM',
  noMatchingContacts: 'No matching contacts. Try searching CRM.',
  alreadyEnrolled: 'Already enrolled',
  crmContact: 'CRM contact',
  contact: 'Contact',
  startSending: 'Start sending (your local time)',
  startTime: 'Sequence start time',
  startHint: {
    one: 'Starts at least 10 minutes from now. Each contact receives {{count}} email, following the sequence delays.',
    other:
      'Starts at least 10 minutes from now. Each contact receives {{count}} emails, following the sequence delays.',
  },
  consent:
    'I have permission to email these contacts and will handle their replies.',
  selectedCount: {
    one: '{{count}} selected · up to {{max}} at a time',
    other: '{{count}} selected · up to {{max}} at a time',
  },
  enrollCount: {
    one: 'Enroll {{count}} contact',
    other: 'Enroll {{count}} contacts',
  },

  // Contacts
  noContacts: 'No contacts yet',
  noContactsHint: 'Your Macro, Gmail, and CRM contacts appear here.',
  noMatchingContactsTitle: 'No matching contacts',
  crm: 'CRM',
  sequenceCount: { one: '{{count}} sequence', other: '{{count}} sequences' },
  openCrmContact: 'Open CRM contact',
  contactEnrollments: 'Email Marketing enrollments',
  contactUnsubscribed: 'Unsubscribed from every campaign.',
  loadingEnrollments: 'Loading enrollments…',
  enrollmentsLoadFailed: 'Couldn’t load Email Marketing enrollments.',
  notEnrolled: 'Not enrolled in any sequence.',
  scheduledEmails: {
    one: '{{count}} scheduled email',
    other: '{{count}} scheduled emails',
  },
  openModule: 'Open Email Marketing',
  unsubscribeTitle: 'Unsubscribe {{email}}?',
  unsubscribeBody:
    'Every campaign stops emailing this address: upcoming emails are canceled and it can’t be enrolled again.',

  // Unsubscribed
  unsubscribedHint:
    'Addresses every campaign skips. Delete a row in the database to allow emails again.',
  noUnsubscribes: 'No one has unsubscribed',

  // Delivery
  connectedGmail: 'Connected Gmail',
  connectedGmailHint:
    'Sequences send from an inbox you already use, and keep sending when Macro is closed.',
  inboxes: 'Inboxes',
  inboxConnected: 'Connected',
  inboxReconnect: 'Reconnect required',
  noInboxes: 'Connect a Gmail inbox in Settings to start sending.',
  inboxesLoadFailed: 'Couldn’t load your Gmail inboxes. Refresh to try again.',
  howSendingWorks: 'How sending works',
  howSendingScheduled:
    'Each email is scheduled in your inbox when you enroll someone. Follow-ups can reply in the first email’s thread.',
  howSendingLimits:
    'Gmail’s daily sending limits apply. There’s no separate sending meter.',
  howSendingReplies:
    'Replies arrive in your inbox. Opens and clicks aren’t tracked.',
  openDatabase: 'Open database',
  unreadableNotice: {
    one: '{{count}} Email Marketing record can’t be read. Fix or delete it in the database.',
    other:
      '{{count}} Email Marketing records can’t be read. Fix or delete them in the database.',
  },

  // Records out of step with the scheduler
  untrackedNotice: {
    one: '{{count}} scheduled sequence email has no campaign record, so nothing here can stop it.',
    other:
      '{{count}} scheduled sequence emails have no campaign record, so nothing here can stop them.',
  },
  cancelUntracked: 'Cancel them',
  orphansNotice: {
    one: '{{count}} enrollment belongs to a campaign that was deleted in the database.',
    other:
      '{{count}} enrollments belong to a campaign that was deleted in the database.',
  },
  stopOrphans: 'Stop them',

  // Confirmations
  noticeCreated: 'Campaign created.',
  noticeSaved: 'Campaign saved.',
  noticeActivated: 'Campaign is active. Enroll contacts to start sending.',
  noticePaused: 'Campaign paused. Upcoming emails were canceled.',
  noticeDeleted: 'Deleted {{name}}.',
  noticeEnrolled: {
    one: '{{count}} contact enrolled. Emails scheduled.',
    other: '{{count}} contacts enrolled. Emails scheduled.',
  },
  noticeEnrollmentPaused: 'Enrollment paused.',
  noticeEnrollmentStopped: 'Enrollment stopped. Upcoming emails canceled.',
  noticeResumed: 'Upcoming emails rescheduled.',
  noticeUnsubscribed: 'Contact unsubscribed from every campaign.',
  noticeOrphansStopped: 'Enrollments without a campaign were stopped.',
  noticeUntrackedCanceled: 'Untracked sequence emails were canceled.',

  // Errors
  errorUnexpected: 'Something went wrong: {{detail}}',
  errorForContact: '{{email}}: {{message}}',
  errorNameRequired: 'Give your campaign a name.',
  errorSenderRequired: 'Choose a connected Gmail inbox.',
  errorStepsRequired: 'Add at least one email.',
  errorSubjectSingleLine: 'Email {{position}}: the subject must be one line.',
  errorSubjectRequired: 'Email {{position}} needs a subject.',
  errorBodyRequired: 'Email {{position}} needs a message.',
  errorOptOutRequired: 'Add an opt-out line.',
  errorDelayRange: 'Email {{position}}: wait between 0 and 365 whole days.',
  errorUnknownPersonalization: 'Unknown personalization: {{tokens}}',
  errorSequenceTooLong:
    'This sequence is too long to send. Keep all emails under {{max}} characters combined.',
  errorSequenceTooLarge:
    'This sequence is too large to save. Shorten its emails and try again.',
  errorInvalidStartTime: 'Choose a valid start time.',
  errorStartTooSoon: 'Choose a start time at least 10 minutes from now.',
  errorSchedulingTooSlow:
    'Scheduling took too long. Choose a later start time.',
  errorInboxDisconnected:
    'This campaign’s Gmail inbox is no longer connected to your account.',
  errorInboxReauth: 'Reconnect this Gmail inbox before sending.',
  errorInboxesLoading: 'Your inboxes are still loading. Try again in a moment.',
  errorCampaignInactive:
    'This campaign is no longer active. Refresh before enrolling.',
  errorCampaignChanged: 'This campaign changed. Refresh and try again.',
  errorActivateFirst: 'Activate the campaign first.',
  errorInvalidEmail: '{{email}} isn’t a valid email address.',
  errorAlreadyEnrolled: '{{email}} is already enrolled in this campaign.',
  errorUnsubscribed: '{{email}} unsubscribed, so no campaign can email it.',
  errorUnreadableRecords:
    'Some Email Marketing records can’t be read. Fix or delete them in the database before enrolling.',
  errorEnrollmentStopped: 'This enrollment was already stopped.',
  errorEnrollmentChanged: 'This enrollment changed. Refresh and try again.',
  errorEnrollmentMissing: 'This enrollment no longer exists.',
  errorNotPaused: 'Only paused enrollments can be resumed.',
  errorNothingToResume: 'There are no upcoming emails to resume.',
  errorScheduleFailed:
    'Some emails couldn’t be scheduled. Emails that weren’t sent were canceled.',
  errorCancelFailed:
    'Some scheduled emails couldn’t be canceled. Open them to check.',
  errorCancelKeepsChanging:
    'A scheduled email keeps changing, so it couldn’t be canceled. Open it to check.',
  errorDraftIdMissing: 'Gmail didn’t return the draft. Try again.',
  errorColumnMissing:
    'The {{name}} column is missing. Restore it in the Email Marketing database.',
  errorNeedEditAccess: 'You need edit access to this Email Marketing database.',
  errorStorageUnavailable: 'Couldn’t reach Email Marketing records. Try again.',
  errorChangedElsewhere:
    'These records changed somewhere else. Refresh and try again.',
  errorRefreshFailed:
    "Done, but the latest records couldn't be loaded. Refresh to see them.",
};
