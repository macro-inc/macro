// Email outside the Email view.

import { BOTH_VIEWPORTS, type Group } from './types';

export const elsewhere = {
  name: 'elsewhere',
  surfaces: [
    {
      id: 'SX-17',
      name: 'App navigation Mail unread badge',
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
      name: 'Universal input (Cmd+K) Email intent: draft or send an email',
      opened: 'Cmd+K with enable-universal-input, intent Email',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-21',
      name: 'AI chat SendEmail draft card (review, edit, attach, send)',
      opened: 'Agent/AI chat tool call SendEmail',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-22',
      name: 'Email rows in global Search (Email filter, text query)',
      opened: 'App search with Email filter',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-23',
      name: 'Email rows in Home / work feed and Home preview',
      opened: '/app (Home)',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-24',
      name: 'Email notifications (new_email, shared email_thread, reminder) in Notifications inbox, toasts, push',
      opened: 'Notifications inbox; notification toast; native push tap',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-25',
      name: 'Email thread mention chip / link (/app/mail/<id> pasted) and quick-access picker entries',
      opened: 'Documents, channels, chat composer mention picker',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-26',
      name: 'CRM contact/company Emails tab, email privacy, compose to contact',
      opened: '/app CRM record pages',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-27',
      name: 'Calendar surfaces fed by email links (setup status, connected inboxes, calendar settings, event guest mailto -> composer)',
      opened: 'Calendar view / Settings > Calendar',
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
      name: 'Settings > Notifications: Email digest toggle',
      opened: 'Settings > Notifications',
      viewports: BOTH_VIEWPORTS,
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
      waiver: { kind: 'native-only', reason: 'native only' },
    },
  ],
  actions: [
    {
      id: 'AX-048',
      surface: 'SX-19',
      action: 'Create a new email from the app Create menu / Launcher',
      trigger: 'menu item "Email"; hotkey E (create.email token)',
      source: ['src/features/command/Launcher.tsx'],
    },
    {
      id: 'AX-049',
      surface: 'SX-20',
      action: 'Universal input: save an email draft',
      trigger: 'Cmd+K, intent Email, save',
      source: ['src/features/universal-input/actions.ts'],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-050',
      surface: 'SX-20',
      action: 'Universal input: send an email',
      trigger: 'Cmd+K, intent Email, submit',
      source: ['src/features/universal-input/actions.ts'],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-051',
      surface: 'SX-20',
      action:
        'Universal input: connect/reconnect inbox when the chosen inbox lacks access',
      trigger: 'inline action',
      source: ['src/features/universal-input/actions.ts'],
      flag: 'enable-universal-input',
    },
    {
      id: 'AX-052',
      surface: 'SX-21',
      action:
        'AI chat email card: edit recipients/subject/body of the drafted email',
      trigger: 'typing in card composer',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'AX-053',
      surface: 'SX-21',
      action: 'AI chat email card: attach a file',
      trigger: 'attach button / drop',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'AX-054',
      surface: 'SX-21',
      action: 'AI chat email card: Send email',
      trigger: 'button "Send email" / Cmd+Enter',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'AX-055',
      surface: 'SX-21',
      action: 'AI chat email card: retry sender lookup / choose From inbox',
      trigger: 'Retry, From picker',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'AX-056',
      surface: 'SX-22',
      action: 'Open an email thread from global Search results',
      trigger: 'click / Enter on result row',
      source: ['src/features/next-soup/search-navigation.ts'],
    },
    {
      id: 'AX-057',
      surface: 'SX-23',
      action: 'Open an email from Home / work feed; mark done from Home',
      trigger: 'click row; e',
      source: ['src/features/home/home-preview-navigation.ts'],
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
      action:
        'Open an email thread from a mention chip or pasted /app/mail/<id> link',
      trigger: 'click mention',
      source: [
        'src/lib/core/context/quickAccess/QuickAccessSource.tsx',
        'src/lib/queries/email/quick-access.ts',
      ],
    },
    {
      id: 'AX-060',
      surface: 'SX-26',
      action: 'CRM: compose an email to a contact',
      trigger: 'button on contact/company record',
      source: [
        'src/features/crm/crm-adapter.ts',
        'src/features/email-view/compose-email.ts',
      ],
      flag: 'enable-crm',
    },
    {
      id: 'AX-061',
      surface: 'SX-27',
      action: 'Calendar setup status: reconnect inbox / enable calendar',
      trigger: 'button',
      source: ['src/features/calendar-view/components/SetupStatus.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-062',
      surface: 'SX-29',
      action: 'Toggle Email digest notifications',
      trigger: 'switch "Email digest"',
      source: ['src/features/settings/Notifications.tsx'],
    },
    {
      id: 'AX-063',
      surface: 'SX-29',
      action:
        'Toggle "New email" notifications (drives the Mail badge) (source line inferred: label comes from the notification type catalog)',
      trigger: 'switch "New email"',
      source: ['src/features/settings/Notifications.tsx'],
    },
  ],
  states: [
    {
      id: 'STX-032',
      surface: 'SX-17',
      state:
        'Mail unread badge in app navigation (hidden when email notifications disabled)',
      trigger: 'unread inbox threads exist',
      source: ['src/components/app/use-navigation-unread.ts'],
    },
    {
      id: 'STX-033',
      surface: 'SX-20',
      state:
        'Universal input validation: "Choose Email", "Connect or choose an email account", "Choose an email address for each guest"; results "Email draft saved", "Email sent"',
      trigger: 'intent validation / submit result',
      source: ['src/features/universal-input/actions.ts'],
    },
    {
      id: 'STX-034',
      surface: 'SX-21',
      state:
        'AI email card: "Resolving sender..." with Send disabled; Retry on lookup failure; "Failed to attach <file>"',
      trigger: 'reply-inbox lookup pending/failed; attach failure',
      source: [
        'src/lib/core/component/AI/component/tool/email/DraftComposer.tsx',
      ],
    },
    {
      id: 'STX-035',
      surface: 'SX-27',
      state:
        'Calendar setup status sync error line "<address> — <calendar>: <error>"',
      trigger: 'calendar sync error on a link',
      source: ['src/features/calendar-view/components/SetupStatus.tsx'],
    },
  ],
} as const satisfies Group;
