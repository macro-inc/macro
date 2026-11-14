// Email outside the Email view.

import { BOTH_VIEWPORTS, type Group } from './types';

export const elsewhere = {
  name: 'elsewhere',
  surfaces: [
    {
      id: 'SX-17',
      name: 'App navigation Mail entry and unread badge',
      opened: 'App sidebar / mobile dock Mail entry',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-18',
      name: 'mailto: link interception into composer',
      opened: 'Click any mailto: link inside the app',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-19',
      name: 'Create menu / Launcher "Email" entry (hotkey E)',
      opened: 'App New/Create menu, Launcher',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-20',
      name: 'Universal input (Cmd+K) Email type: draft or send an email',
      opened: 'Cmd+K with enable-universal-input, content type Email',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-21',
      name: 'Agent send-email tool: draft review composer and its result cards',
      opened:
        'Agent session asking to send an email (live prompt or review deck); the tool call in the transcript',
      viewports: BOTH_VIEWPORTS,
      needs: 'the AI service',
    },
    {
      id: 'SX-120',
      name: 'Agent email tool cards (read thread, list inboxes, list / update labels)',
      opened: 'Agent or AI chat transcript after an email tool call',
      viewports: BOTH_VIEWPORTS,
      needs: 'the AI service',
    },
    {
      id: 'SX-22',
      name: 'Email rows in global Search (Email category, text query)',
      opened: 'App search with the Email category',
      viewports: BOTH_VIEWPORTS,
      needs: 'the search service',
    },
    {
      id: 'SX-23',
      name: 'Email in Home: work feed rows, Email filter, connect-email prompts',
      opened: '/app (Home)',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-24',
      name: 'Email notifications (new_email, shared email_thread, reminder) in the Notifications inbox, toasts, push',
      opened: 'Notifications inbox; notification toast; native push tap',
      viewports: BOTH_VIEWPORTS,
      needs: 'the notification service',
    },
    {
      id: 'SX-25',
      name: 'Email thread mention chip, pasted /app/mail/<id> link, and email entries in the mention menu / quick access',
      opened: 'Documents, channels, chat composer mention menu',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-26',
      name: 'CRM contact / company Emails section, email privacy, compose to contact',
      opened: 'CRM record pages; CRM settings',
      viewports: BOTH_VIEWPORTS,
      needs: 'the CRM service',
    },
    {
      id: 'SX-27',
      name: 'Calendar surfaces fed by email links (setup status, event guest email -> composer)',
      opened: 'Calendar view',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-28',
      name: 'Settings > Shortcuts: Email and Email drafts sections',
      opened: 'Settings > Shortcuts',
      viewports: ['desktop'],
    },
    {
      id: 'SX-29',
      name: 'Settings > Notifications: Email digest and New email toggles',
      opened: 'Settings > Notifications',
      viewports: BOTH_VIEWPORTS,
      needs: 'the notification service',
    },
    {
      id: 'SX-30',
      name: 'Standalone email block split (legacy/direct links)',
      opened: '/app/email/<thread-id>[?email_message_id=]',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-31',
      name: 'View tour for Email',
      opened: 'Tour launcher on Email view',
      viewports: ['desktop'],
    },
    {
      id: 'SX-32',
      name: 'Tauri-only paths: desktop system-browser consent, native mobile auth session, push-notification launch into a thread, native offline cache/filters, OTA update-required dialog for draft queue',
      opened: 'Tauri desktop / iOS / Android builds',
      viewports: [],
      waiver: {
        kind: 'native-only',
        reason:
          'These paths run only inside the Tauri desktop and mobile apps.',
      },
    },
  ],
  actions: [
    {
      id: 'AX-302',
      surface: 'SX-18',
      action: 'Open the composer from a mailto: link, To prefilled',
      trigger: 'plain click on a mailto: link (modifier clicks are left alone)',
      source: [
        'src/components/app/mailtoComposerHandler.ts',
        'src/lib/core/util/interceptMailtoLinks.ts',
        'src/components/app/Layout.tsx',
      ],
    },
    {
      id: 'AX-048',
      surface: 'SX-19',
      action: 'Create a new email from the app Create menu / Launcher',
      trigger: 'menu item "Email"',
      source: ['src/features/command/Launcher.tsx'],
    },
    {
      id: 'AX-304',
      surface: 'SX-19',
      action: 'Create a new email from the mobile page create button on Mail',
      trigger: 'create button of the Mail page',
      source: [
        'src/components/app/mobile/mobile-page-create-action.ts',
        'src/features/command/Launcher.tsx',
      ],
      viewports: ['phone'],
    },
    {
      id: 'AX-305',
      surface: 'SX-20',
      action: 'Universal input: choose the Email content type',
      trigger: 'select "Content type" > Email',
      source: ['src/features/universal-input/views/universal-composer.tsx'],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-306',
      surface: 'SX-20',
      action:
        'Universal input: fill From, To, Cc, Bcc, Subject and the message',
      trigger:
        'From selector; recipient inputs ("Cc/Bcc" reveals Cc and Bcc); Subject; body "Outgoing message"',
      source: ['src/features/universal-input/views/email-draft.tsx'],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-049',
      surface: 'SX-20',
      action: 'Universal input: save an email draft',
      trigger: 'button "Save as draft"',
      source: [
        'src/features/universal-input/views/universal-composer.tsx',
        'src/features/universal-input/actions.ts',
      ],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-050',
      surface: 'SX-20',
      action: 'Universal input: send an email',
      trigger: 'button "Send email" / Cmd+Enter',
      source: [
        'src/features/universal-input/views/universal-composer.tsx',
        'src/features/universal-input/actions.ts',
      ],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-051',
      surface: 'SX-20',
      action: 'Universal input: connect Google when no inbox is connected',
      trigger: 'button "Connect Google"',
      source: [
        'src/features/universal-input/views/universal-composer.tsx',
        'src/features/universal-input/actions.ts',
      ],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-307',
      surface: 'SX-20',
      action: 'Universal input: open the saved draft or sent thread',
      trigger: 'open action on the "Email draft saved" / "Email sent" result',
      source: ['src/features/universal-input/actions.ts'],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-052',
      surface: 'SX-21',
      action:
        'Send-email review: edit recipients, subject or body of the drafted email',
      trigger: 'type in the review composer',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
        'src/features/agent-interactions/components/LiveElicitation.tsx',
      ],
    },
    {
      id: 'AX-053',
      surface: 'SX-21',
      action: 'Send-email review: attach a file',
      trigger: 'attach button / drop',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
        'src/lib/core/component/AI/component/tool/email/draft-attachments.ts',
      ],
    },
    {
      id: 'AX-054',
      surface: 'SX-21',
      action: 'Send-email review: approve and send',
      trigger: 'button "Send email" / Cmd+Enter',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'AX-055',
      surface: 'SX-21',
      action: 'Send-email review: retry the sender lookup',
      trigger: 'button "Retry" on the sender notice',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'AX-308',
      surface: 'SX-21',
      action: 'Send-email review: choose the sending inbox',
      trigger: 'From selector',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
        'src/lib/core/component/AI/component/tool/email/sending-inbox.ts',
      ],
    },
    {
      id: 'AX-309',
      surface: 'SX-21',
      action: 'Send-email review: remove the signature preview',
      trigger: 'dismiss button on the signature preview',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-310',
      surface: 'SX-21',
      action: 'Review deck: move between several drafted emails',
      trigger:
        'buttons "Previous draft" / "Next draft"; draft chooser; "Search drafts"',
      source: [
        'src/features/agent-reviews/views/review-stack.tsx',
        'src/features/agent-reviews/components/review-navigation.tsx',
      ],
    },
    {
      id: 'AX-311',
      surface: 'SX-21',
      action:
        'Open the saved draft from a "saved as draft" card (Shift opens a new split)',
      trigger: 'draft button labelled with the subject or "Draft email"',
      source: ['src/lib/core/component/AI/component/tool/SendEmail.tsx'],
    },
    {
      id: 'AX-312',
      surface: 'SX-21',
      action: 'Expand an "Email sent to …" card to preview the sent thread',
      trigger: 'click the card summary',
      source: [
        'src/lib/core/component/AI/component/tool/SendEmail.tsx',
        'src/lib/core/component/AI/component/tool/SendConfirmedEmail.tsx',
      ],
    },
    {
      id: 'AX-313',
      surface: 'SX-120',
      action: 'Expand the list of inboxes on a "List inboxes" card',
      trigger: 'toggle "N inboxes"',
      source: ['src/lib/core/component/AI/component/tool/ListInboxes.tsx'],
    },
    {
      id: 'AX-056',
      surface: 'SX-22',
      action:
        'Open an email thread from a Search result (a content hit opens at the matching message)',
      trigger: 'click / Enter on result row or snippet',
      source: ['src/features/next-soup/search-navigation.ts'],
    },
    {
      id: 'AX-057',
      surface: 'SX-23',
      action: 'Open an email from the Home work feed',
      trigger: 'click row',
      source: [
        'src/features/home/home-preview-navigation.ts',
        'src/features/home/components/HomeList.tsx',
      ],
    },
    {
      id: 'AX-314',
      surface: 'SX-23',
      action: 'Mark an email done from Home',
      trigger: 'row "Mark done" action; e on a focused row',
      source: ['src/features/home/components/HomeList.tsx'],
    },
    {
      id: 'AX-315',
      surface: 'SX-23',
      action: 'Filter Home to email',
      trigger: 'filter "Email"',
      source: [
        'src/features/home/home-facets.ts',
        'src/features/home/components/HomeFilters.tsx',
      ],
    },
    {
      id: 'AX-316',
      surface: 'SX-23',
      action: 'Connect email from the Home empty state',
      trigger: 'button "Connect email" under "Welcome home"',
      source: ['src/features/home/components/HomeEmptyState.tsx'],
    },
    {
      id: 'AX-317',
      surface: 'SX-23',
      action: 'Open Settings > Email from Home suggestions',
      trigger: 'button "Connect your inbox for suggested actions"',
      source: [
        'src/features/home/components/home-suggestions.tsx',
        'src/features/home/components/home-recommended-actions.tsx',
      ],
    },
    {
      id: 'AX-058',
      surface: 'SX-24',
      action:
        'Open an email thread from a notification (new_email, shared thread, reminder)',
      trigger: 'click notification row / toast / push',
      source: ['src/features/notifications/notification-navigation.ts'],
    },
    {
      id: 'AX-059',
      surface: 'SX-25',
      action: 'Open an email thread from a mention chip',
      trigger: 'click mention',
      source: [
        'src/lib/core/component/LexicalMarkdown/component/decorator/DocumentMention.tsx',
      ],
    },
    {
      id: 'AX-318',
      surface: 'SX-25',
      action: 'Mention an email thread from the mention menu',
      trigger: '@, section "Emails", pick a thread',
      source: [
        'src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu.tsx',
        'src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useEmailSearchMention.ts',
        'src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/mentionHandlers.ts',
      ],
      needs: 'the search service',
    },
    {
      id: 'AX-319',
      surface: 'SX-25',
      action: 'Paste a /app/mail/<id> link to get an email mention',
      trigger: 'paste the link copied by "Copy Link" into an editor',
      source: [
        'src/lib/core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin.ts',
      ],
    },
    {
      id: 'AX-060',
      surface: 'SX-26',
      action:
        'CRM: compose an email (addressed to the contact on a contact record)',
      trigger:
        'button "New email" on the Emails section, its empty state, or the Activity email tab',
      source: [
        'src/features/crm/crm-adapter.ts',
        'src/features/crm/views/contact-emails-section.tsx',
        'src/features/crm/views/company-emails-section.tsx',
        'src/features/crm/views/activity.tsx',
        'src/features/email-view/compose-email.ts',
      ],
      flag: 'enable-crm',
    },
    {
      id: 'AX-320',
      surface: 'SX-26',
      action: 'CRM Emails: switch Signal / All',
      trigger: 'toggle "Email importance"',
      source: [
        'src/features/crm/views/contact-emails-section.tsx',
        'src/features/crm/views/company-emails-section.tsx',
      ],
      flag: 'enable-crm',
    },
    {
      id: 'AX-321',
      surface: 'SX-26',
      action: 'CRM Emails: switch Team / Me inboxes',
      trigger: 'toggle "Email inboxes"',
      source: [
        'src/features/crm/views/contact-emails-section.tsx',
        'src/features/crm/views/company-emails-section.tsx',
      ],
      flag: 'enable-crm',
    },
    {
      id: 'AX-322',
      surface: 'SX-26',
      action: 'CRM email privacy: add or remove an excluded domain',
      trigger: 'domain input; remove button on a domain row',
      source: ['src/features/crm/views/email-privacy.tsx'],
      flag: 'enable-crm',
    },
    {
      id: 'AX-061',
      surface: 'SX-27',
      action:
        'Calendar setup status: connect, grant access, turn on or reconnect',
      trigger:
        'button "Connect calendar" / "Grant access" / "Turn on" / "Reconnect"',
      source: ['src/features/calendar-view/components/SetupStatus.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-323',
      surface: 'SX-27',
      action: 'Email the guests of a calendar event (composer with To filled)',
      trigger: 'guest email / email-guests action on an event',
      source: ['src/features/calendar-view/components/use-open-event-email.ts'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-062',
      surface: 'SX-29',
      action: 'Toggle Email digest notifications',
      trigger: 'switch on the row "Email digest"',
      source: ['src/features/settings/Notifications.tsx'],
    },
    {
      id: 'AX-063',
      surface: 'SX-29',
      action: 'Toggle "New email" notifications (also hides the Mail badge)',
      trigger: 'switch on the row "New email" ("When a new email arrives")',
      source: [
        'src/features/settings/Notifications.tsx',
        'src/features/notifications/notification-event-catalog.ts',
      ],
    },
    {
      id: 'AX-324',
      surface: 'SX-30',
      action: 'Open a thread by its direct link in a standalone split',
      trigger: 'navigate to /app/email/<thread-id>; Shift-click a thread',
      source: [
        'src/routes/routes.ts',
        'src/features/block-email/EmailBlockAdapter.tsx',
      ],
    },
    {
      id: 'AX-325',
      surface: 'SX-31',
      action: 'Email tour: open Settings > Email to connect',
      trigger: 'tour button "Google" (shown until an inbox is connected)',
      source: [
        'src/features/tours/ViewTour.tsx',
        'src/features/email-view/tour.ts',
      ],
    },
  ],
  states: [
    {
      id: 'STX-032',
      surface: 'SX-17',
      state:
        'Unread mark on the Mail navigation entry; hidden when "New email" notifications are off',
      trigger: 'an unread, not-done Signal thread in the loaded page',
      source: ['src/components/app/use-navigation-unread.ts'],
    },
    {
      id: 'STX-300',
      surface: 'SX-18',
      state: 'New email composer open with the mailto address in To',
      trigger: 'mailto: link clicked',
      source: ['src/components/app/mailtoComposerHandler.ts'],
    },
    {
      id: 'STX-033',
      surface: 'SX-20',
      state:
        'Validation line: "Choose Email", "Connect or choose an email account", "Choose a specific recipient for …", "Add a subject", "Attached context is supported for AI. Remove it or choose AI."; buttons disabled',
      trigger: 'incomplete email draft',
      source: [
        'src/features/universal-input/actions.ts',
        'src/features/universal-input/core/input.ts',
      ],
      flag: 'enable-universal-input',
    },
    {
      id: 'STX-301',
      surface: 'SX-20',
      state:
        '"Connect Google to send email and create calendar events. Then return here to compose."',
      trigger: 'Email type with no connected inbox',
      source: ['src/features/universal-input/views/universal-composer.tsx'],
      flag: 'enable-universal-input',
    },
    {
      id: 'STX-302',
      surface: 'SX-20',
      state: 'Toast "Could not connect Google. Please try again."',
      trigger: 'Connect Google failed',
      source: ['src/features/universal-input/actions.ts'],
      flag: 'enable-universal-input',
    },
    {
      id: 'STX-303',
      surface: 'SX-20',
      state:
        'Result "Email draft saved" / "Email sent"; buttons "Saving…" / "Working…" while pending',
      trigger: 'save or send finished / pending',
      source: [
        'src/features/universal-input/actions.ts',
        'src/features/universal-input/views/universal-composer.tsx',
      ],
      flag: 'enable-universal-input',
    },
    {
      id: 'STX-034',
      surface: 'SX-21',
      state:
        'Sender notice: "Resolving sender...", "Could not load your inboxes. Try again.", "<from> is unavailable. Choose a connected sending inbox.", "Could not resolve the reply sender. Try again or choose a sending inbox.", "Connect an inbox to send email."; Send disabled',
      trigger: 'sender lookup pending / failed / no usable inbox',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
        'src/lib/core/component/AI/component/tool/email/sending-inbox.ts',
      ],
    },
    {
      id: 'STX-304',
      surface: 'SX-21',
      state: 'toast: "Failed to attach <file>"',
      trigger: 'attaching a file to the drafted email failed',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
      toasts: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx#Failed to attach ${file.name}',
      ],
    },
    {
      id: 'STX-305',
      surface: 'SX-21',
      state: 'Validation "Add at least one recipient" / "Write a message"',
      trigger: 'send with no recipient / empty body',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'STX-306',
      surface: 'SX-21',
      state:
        'Read-only composer: in a legacy AI chat, or with "Only the person whose account this review uses can submit it."',
      trigger: 'viewer cannot act on the draft',
      source: [
        'src/lib/core/component/AI/component/tool/email/ChatCompose.tsx',
        'src/features/agent-reviews/views/review-stack.tsx',
      ],
    },
    {
      id: 'STX-307',
      surface: 'SX-21',
      state:
        'Result card: "Email not sent", "Email send rejected", "Email sent to <recipients> [from x] [with N attachments]", "Email saved as draft for <recipients>", "Email edited by the user"',
      trigger: 'tool call pending / rejected / sent / saved as draft / edited',
      source: [
        'src/lib/core/component/AI/component/tool/SendEmail.tsx',
        'src/lib/core/component/AI/component/tool/SendConfirmedEmail.tsx',
      ],
    },
    {
      id: 'STX-308',
      surface: 'SX-120',
      state: 'Card "Read N <type>s" / "Read thread"',
      trigger: 'agent read email threads',
      source: [
        'src/lib/core/component/AI/component/tool/ReadThread.tsx',
        'src/lib/core/component/AI/component/tool/GetThread.tsx',
      ],
    },
    {
      id: 'STX-309',
      surface: 'SX-120',
      state:
        'Card "List inboxes" with "No inboxes" / "1 inbox" / "N inboxes"; rows marked Primary, Delegated or Connected',
      trigger: 'agent listed inboxes',
      source: ['src/lib/core/component/AI/component/tool/ListInboxes.tsx'],
    },
    {
      id: 'STX-310',
      surface: 'SX-120',
      state: 'Cards "List email labels" and the update-labels call',
      trigger: 'agent listed or changed thread labels',
      source: [
        'src/lib/core/component/AI/component/tool/ListLabels.tsx',
        'src/lib/core/component/AI/component/tool/UpdateThreadLabels.tsx',
      ],
    },
    {
      id: 'STX-311',
      surface: 'SX-23',
      state:
        'Empty Home "Welcome home": "… Connect email to include your inbox, too." with "Connect email"',
      trigger: 'Home empty and no inbox connected',
      source: ['src/features/home/components/HomeEmptyState.tsx'],
    },
    {
      id: 'STX-312',
      surface: 'SX-23',
      state:
        'A returned email reminder shows as a notification on that email row in Home',
      trigger: 'snooze / reminder comes due',
      source: [
        'src/features/home/queries/use-home-query.ts',
        'src/features/notifications/use-notification-updates.ts',
      ],
      needs: 'the notification service',
    },
    {
      id: 'STX-313',
      surface: 'SX-24',
      state:
        'Email notification row: sender, "sent you an email" / "responded to thread", subject and snippet; reminder rows labelled reminder',
      trigger: 'new_email / reminder notification in the inbox',
      source: [
        'src/features/notifications-inbox/primitives/describe-row.ts',
        'src/features/notifications/notification-sender.ts',
      ],
    },
    {
      id: 'STX-314',
      surface: 'SX-25',
      state:
        'Email entries in the mention menu / quick access: cached threads by subject and sender, unsynced local drafts, "No Subject" fallback',
      trigger: 'typing a name in the mention menu or Cmd+K',
      source: [
        'src/lib/core/context/quickAccess/QuickAccessSource.tsx',
        'src/lib/queries/email/quick-access.ts',
        'src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/mentionHandlers.ts',
      ],
    },
    {
      id: 'STX-315',
      surface: 'SX-26',
      state:
        'Emails section empty: "No signal emails with this contact yet." / "… in your inbox"; "Email sync is disabled for this company."',
      trigger: 'no matching threads / company email sync off',
      source: [
        'src/features/crm/views/contact-emails-section.tsx',
        'src/features/crm/views/company-emails-section.tsx',
      ],
      flag: 'enable-crm',
    },
    {
      id: 'STX-316',
      surface: 'SX-27',
      state:
        'Setup status "Connect your calendar" / "Enable calendar" / "Calendar is off" / "Reconnect calendar": overlay on an empty grid, pill when events show',
      trigger:
        'no own inbox / calendar permission missing / calendar turned off / re-auth needed',
      source: ['src/features/calendar-view/components/SetupStatus.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'STX-035',
      surface: 'SX-27',
      state:
        'Calendar sync warning line "<address> — <calendar>: <error>" (role status)',
      trigger: 'a visible calendar reports a sync error and setup is complete',
      source: ['src/features/calendar-view/components/SetupStatus.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'STX-317',
      surface: 'SX-28',
      state:
        'Shortcut reference sections "Email" (Search email, Star or unstar, Mute or unmute, …) and "Email drafts" (Discard draft, Attach files, …)',
      trigger: 'open Settings > Shortcuts',
      source: ['src/features/settings/Shortcuts.tsx'],
    },
    {
      id: 'STX-318',
      surface: 'SX-30',
      state:
        'Target message expanded, scrolled into view and briefly highlighted (older pages loaded as needed)',
      trigger: 'direct link with ?email_message_id=<message-id>',
      source: [
        'src/routes/routes.ts',
        'src/features/email-thread/core/location.ts',
      ],
    },
    {
      id: 'STX-319',
      surface: 'SX-31',
      state:
        'Tour steps "Find the signal in your inbox" and "Move faster with shortcuts", with the Macro Mail video',
      trigger: 'start the Email tour',
      source: ['src/features/email-view/tour.ts'],
    },
  ],
} as const satisfies Group;
