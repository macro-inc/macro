// Settings › Email, signatures, connecting and reconnecting inboxes.

import { BOTH_VIEWPORTS, type Group } from './types';

export const settings = {
  name: 'settings',
  surfaces: [
    {
      id: 'SX-01',
      name: 'Settings > Email page (Accounts, Signatures, Read receipts, Related settings)',
      opened: 'Settings dialog/sheet > Email tab',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-101',
      name: 'Settings > Connected (integrations) page: Email card',
      opened: 'Settings > Connected',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-02',
      name: 'Remove inbox confirmation dialog',
      opened: 'Settings > Email > inbox row > Remove',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-03',
      name: 'Turn off calendar confirmation dialog',
      opened: 'Settings > Email > inbox row > Turn off calendar',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-04',
      name: 'Signature editor (Preview / Rich text / HTML tabs, import from Gmail, add to replies & forwards)',
      opened: 'Settings > Email > Signatures, one per connected inbox',
      viewports: ['desktop'],
    },
    {
      id: 'SX-05',
      name: 'Inbox settings operations notice (label and block-list changes waiting on the mailbox)',
      opened:
        'Settings > Email, under an inbox whose settings write is pending or failed',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-06',
      name: 'Connect email provider chooser dialog (Gmail / Outlook)',
      opened:
        'Any "connect" entry point without a provider, when Outlook is offered (Settings Enable, Home "Connect email", Email empty state)',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-07',
      name: 'Add inbox dialog (the provider chooser opened by the app shell)',
      opened:
        'After admin approval return; "Try again" on the "Email access required" prompt',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-08',
      name: 'Provider consent return route',
      opened:
        '/app/inbox-link-callback?link_id=... (web redirect); macro:///inbox-link-callback (desktop); native auth session (mobile)',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-100',
      name: 'Email sign-up callback route',
      opened: '/app/email-signup-callback',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-09',
      name: 'Admin approval required dialog (Microsoft 365 tenant)',
      opened: 'Returned from Outlook consent with admin_consent_required',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-10',
      name: 'Share inbox conflict dialog (inbox already owned by another Macro user)',
      opened: 'Returned from consent with SharedInboxConflict',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-11',
      name: 'Reconnect inbox prompt (persistent toast)',
      opened: 'App shell, when a link needs re-auth',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-12',
      name: 'Enable calendar prompt (persistent toast)',
      opened: 'App shell, when an own inbox lacks calendar permission',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-13',
      name: '"Email access required" prompt (persistent toast)',
      opened:
        'Returned from Google consent with the email permissions unchecked (email_link_error=gmail_not_granted)',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-14',
      name: 'Onboarding email step (connect work / personal email)',
      opened: '/app/onboarding (email step)',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SX-15',
      name: 'Mobile onboarding Connected Accounts',
      opened: 'Native mobile onboarding',
      viewports: [],
      waiver: {
        kind: 'native-only',
        reason:
          'MobileOnboarding is rendered only when isNativeMobilePlatform() is true.',
      },
    },
    {
      id: 'SX-16',
      name: 'Sign-out "remove local drafts?" confirmation',
      opened: 'Sign out with unsynced drafts or queued sends',
      viewports: BOTH_VIEWPORTS,
    },
  ],
  actions: [
    {
      id: 'AX-001',
      surface: 'SX-01',
      action: 'Connect a Google Workspace account',
      trigger:
        'button "Connect" (aria "Connect a Google Workspace account"; title "Connect another Google Workspace account" once an inbox exists)',
      source: [
        'src/features/settings/Email.tsx',
        'src/lib/core/email-link/index.ts',
      ],
      providers: ['gmail'],
      note: 'With an inbox already connected the row shows only under enable-multi-inbox.',
    },
    {
      id: 'AX-002',
      surface: 'SX-01',
      action: 'Connect an Outlook account',
      trigger: 'button "Connect" (aria "Connect an Outlook account")',
      source: [
        'src/features/settings/Email.tsx',
        'src/lib/core/email-link/index.ts',
      ],
      providers: ['outlook'],
      note: 'Row shown only when GET /auth/link/email/providers offers Outlook; with an inbox already connected only under enable-multi-inbox.',
    },
    {
      id: 'AX-003',
      surface: 'SX-01',
      action: 'Enable a disabled primary inbox (opens the provider chooser)',
      trigger: 'button "Enable" on the row with chips "Primary", "Disabled"',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'AX-004',
      surface: 'SX-01',
      action: 'Reconnect an inbox whose sync needs re-auth',
      trigger: 'button "Reconnect" (aria "Reconnect <address>")',
      source: [
        'src/features/settings/Email.tsx',
        'src/lib/core/email-link/consent.ts',
      ],
    },
    {
      id: 'AX-005',
      surface: 'SX-01',
      action: 'Enable calendar for an inbox that lacks calendar permission',
      trigger:
        'button "Enable calendar" (aria "Enable calendar for <address>")',
      source: ['src/features/settings/Email.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-006',
      surface: 'SX-01',
      action: 'Open Turn off calendar dialog (own inbox only)',
      trigger:
        'icon button aria "Turn off calendar for <address>" (tooltip "Turn off calendar")',
      source: ['src/features/settings/Email.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-009',
      surface: 'SX-01',
      action: 'Force sync an inbox',
      trigger: 'icon button aria "Force sync <address>"',
      source: ['src/features/settings/Email.tsx'],
      flag: 'ENABLE_INBOX_RESYNC',
    },
    {
      id: 'AX-010',
      surface: 'SX-01',
      action: 'Open Remove inbox dialog',
      trigger:
        'button "Remove" (aria "Remove <address>", tooltip "Remove inbox")',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'AX-013',
      surface: 'SX-01',
      action: 'Retry loading accounts / signatures',
      trigger: 'button "Try again"',
      source: ['src/features/settings/email-settings.tsx'],
    },
    {
      id: 'AX-014',
      surface: 'SX-01',
      action: 'Toggle read receipts for an own inbox',
      trigger: 'switch "Read receipts for <address>"',
      source: ['src/features/settings/email-settings.tsx'],
      flag: 'enable-email-read-receipts',
    },
    {
      id: 'AX-015',
      surface: 'SX-01',
      action: 'Open Notifications settings from Email settings',
      trigger: 'button "Manage notifications"',
      source: ['src/features/settings/email-settings.tsx'],
    },
    {
      id: 'AX-016',
      surface: 'SX-01',
      action: 'Open Calendar settings from Email settings',
      trigger: 'button "Manage calendars"',
      source: ['src/features/settings/email-settings.tsx'],
    },
    {
      id: 'AX-200',
      surface: 'SX-101',
      action: 'Open Email settings from the Connected page',
      trigger: 'icon button "Email settings" on the Email section',
      source: ['src/features/settings/IntegrationsPage.tsx'],
    },
    {
      id: 'AX-011',
      surface: 'SX-02',
      action:
        'Confirm remove inbox (own inbox: clears data; shared inbox: removes access)',
      trigger: 'dialog "Remove inbox", button "Remove"',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'AX-012',
      surface: 'SX-02',
      action: 'Cancel remove inbox',
      trigger: 'button "Cancel" / dismiss dialog',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'AX-007',
      surface: 'SX-03',
      action: 'Confirm turn off calendar',
      trigger: 'dialog "Turn off calendar", button "Turn off"',
      source: ['src/features/calendar/components/TurnOffCalendarDialog.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-008',
      surface: 'SX-03',
      action: 'Cancel turn off calendar',
      trigger: 'button "Cancel"',
      source: ['src/features/calendar/components/TurnOffCalendarDialog.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AX-017',
      surface: 'SX-04',
      action: 'Edit signature in rich text (typing)',
      trigger: 'type in editor "Signature for <address>" (Rich text tab)',
      source: [
        'src/features/settings/SignatureEditor.tsx',
        'src/features/settings/components/signature-workspace.tsx',
      ],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-018',
      surface: 'SX-04',
      action:
        'Format signature: Font, Font size, Bold (Cmd+B), Italic (Cmd+I), Underline (Cmd+U), Text color, Highlight color, Numbered list, Bulleted list, Link, Clear formatting',
      trigger: 'toolbar buttons / selects',
      source: ['src/features/settings/SignatureEditor.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-019',
      surface: 'SX-04',
      action: 'Insert an image into the signature (uploaded as a static file)',
      trigger: 'toolbar "Image"; paste or drop an image',
      source: ['src/features/settings/SignatureEditor.tsx'],
      flag: 'enable-email-signatures',
      needs: 'the static file service',
    },
    {
      id: 'AX-201',
      surface: 'SX-04',
      action: 'Resize an image in the signature',
      trigger: 'drag the resize handle of a selected image',
      source: ['src/features/settings/SignatureEditor.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-202',
      surface: 'SX-04',
      action: 'Paste a URL over selected text to make it a link',
      trigger: 'paste a URL with text selected in Rich text',
      source: [
        'src/features/settings/SignatureEditor.tsx',
        'src/features/settings/pastedHyperlinkHref.ts',
      ],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-020',
      surface: 'SX-04',
      action: 'Switch signature view: Preview / Rich text / HTML',
      trigger: 'tabs "Signature views for <address>"',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-021',
      surface: 'SX-04',
      action: 'Edit signature HTML source',
      trigger: 'textarea "Signature HTML for <address>"',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-022',
      surface: 'SX-04',
      action:
        'Confirm "Convert to rich text?" when opening Rich text on custom HTML',
      trigger: 'confirm dialog button "Continue to rich text"',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-203',
      surface: 'SX-04',
      action: 'Cancel "Convert to rich text?" (stays on the current tab)',
      trigger: 'confirm dialog "Cancel"',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-204',
      surface: 'SX-04',
      action:
        'Paste a signature with custom HTML into an empty Rich text editor (kept as HTML, no dialog)',
      trigger: 'paste formatted HTML in Rich text',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-023',
      surface: 'SX-04',
      action:
        'Confirm "Replace with pasted signature?" (pasting custom HTML over an existing signature)',
      trigger: 'confirm dialog button "Use pasted signature"',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-205',
      surface: 'SX-04',
      action: 'Cancel "Replace with pasted signature?"',
      trigger: 'confirm dialog "Cancel"',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-024',
      surface: 'SX-04',
      action: 'Save signature',
      trigger: 'button "Save signature"',
      source: [
        'src/features/settings/components/signature-form.tsx',
        'src/features/settings/SignatureSection.tsx',
      ],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-025',
      surface: 'SX-04',
      action: 'Clear signature',
      trigger: 'button "Clear signature"',
      source: [
        'src/features/settings/components/signature-form.tsx',
        'src/features/settings/SignatureSection.tsx',
      ],
      viewports: BOTH_VIEWPORTS,
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-026',
      surface: 'SX-04',
      action: 'Import signature from Gmail',
      trigger: 'button "Import from Gmail"',
      source: [
        'src/features/settings/components/signature-form.tsx',
        'src/features/settings/SignatureSection.tsx',
      ],
      providers: ['gmail'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-027',
      surface: 'SX-04',
      action: 'Toggle "Add to replies & forwards"',
      trigger: 'switch "Add to replies & forwards"',
      source: [
        'src/features/settings/components/signature-form.tsx',
        'src/features/settings/SignatureSection.tsx',
      ],
      viewports: BOTH_VIEWPORTS,
      flag: 'enable-email-signatures',
    },
    {
      id: 'AX-028',
      surface: 'SX-06',
      action: 'Choose Gmail in provider chooser',
      trigger: 'dialog "Connect email", button "Gmail"',
      source: [
        'src/lib/core/email-link/ProviderDialog.tsx',
        'src/lib/core/email-link/index.ts',
      ],
      providers: ['gmail'],
    },
    {
      id: 'AX-029',
      surface: 'SX-06',
      action: 'Choose Outlook in provider chooser',
      trigger: 'dialog "Connect email", button "Outlook / Microsoft 365"',
      source: [
        'src/lib/core/email-link/ProviderDialog.tsx',
        'src/lib/core/email-link/index.ts',
      ],
      providers: ['outlook'],
    },
    {
      id: 'AX-030',
      surface: 'SX-06',
      action: 'Cancel provider chooser',
      trigger: 'button "Cancel" / dismiss',
      source: ['src/lib/core/email-link/ProviderDialog.tsx'],
    },
    {
      id: 'AX-206',
      surface: 'SX-07',
      action: 'Choose a provider in the Add inbox dialog',
      trigger:
        'dialog "Connect email", button "Gmail" or "Outlook / Microsoft 365"',
      source: [
        'src/features/inbox/AddInboxDialog.tsx',
        'src/lib/core/email-link/ProviderDialog.tsx',
      ],
    },
    {
      id: 'AX-207',
      surface: 'SX-07',
      action: 'Cancel the Add inbox dialog',
      trigger: 'button "Cancel" / dismiss',
      source: ['src/features/inbox/AddInboxDialog.tsx'],
    },
    {
      id: 'AX-031',
      surface: 'SX-08',
      action:
        'Return from provider consent (success): inbox initialised; stashed layout restored, else Home with Settings > Connected, else Mail on phone; first-run user goes back to onboarding',
      trigger: 'browser redirect to /app/inbox-link-callback?link_id=',
      source: [
        'src/features/auth/EmailAuth.tsx',
        'src/lib/core/email-link/link-outcome.ts',
      ],
    },
    {
      id: 'AX-032',
      surface: 'SX-08',
      action:
        'Return from provider consent after cancelling on the consent screen',
      trigger: 'browser redirect with email_link_error=cancelled',
      source: [
        'src/features/auth/EmailAuth.tsx',
        'src/lib/core/email-link/link-outcome.ts',
      ],
    },
    {
      id: 'AX-033',
      surface: 'SX-08',
      action: 'Leave the callback page while it is still finishing',
      trigger: 'button "Back to app" under "Finishing account connection…"',
      source: ['src/features/auth/EmailAuth.tsx'],
    },
    {
      id: 'AX-036',
      surface: 'SX-08',
      action:
        'Return after an administrator approved the tenant (toast, then the Add inbox dialog opens)',
      trigger: 'browser redirect with email_link_notice=admin_consent_granted',
      source: ['src/features/auth/EmailAuth.tsx'],
      providers: ['outlook'],
    },
    {
      id: 'AX-034',
      surface: 'SX-09',
      action: 'Copy admin approval link',
      trigger: 'button "Copy admin approval link"',
      source: ['src/features/inbox/AdminConsentRequiredDialog.tsx'],
      providers: ['outlook'],
    },
    {
      id: 'AX-035',
      surface: 'SX-09',
      action: 'Connect a different account',
      trigger: 'button "Connect a different account"',
      source: [
        'src/features/inbox/AdminConsentRequiredDialog.tsx',
        'src/features/auth/EmailAuth.tsx',
      ],
      providers: ['outlook'],
    },
    {
      id: 'AX-037',
      surface: 'SX-10',
      action: 'Share an inbox already owned by another user',
      trigger: 'dialog "Share this inbox?", button "Share inbox"',
      source: [
        'src/features/inbox/ShareInboxConflictDialog.tsx',
        'src/features/auth/EmailAuth.tsx',
        'src/lib/core/email-link/share-conflict.ts',
      ],
    },
    {
      id: 'AX-038',
      surface: 'SX-10',
      action: 'Cancel share inbox conflict',
      trigger: 'button "Cancel"',
      source: ['src/features/inbox/ShareInboxConflictDialog.tsx'],
    },
    {
      id: 'AX-039',
      surface: 'SX-11',
      action: 'Reconnect from the reconnect prompt',
      trigger: 'toast action "Reconnect"',
      source: [
        'src/features/auth/GmailReauthenticationPrompt.tsx',
        'src/lib/core/email-link/consent.ts',
      ],
    },
    {
      id: 'AX-208',
      surface: 'SX-11',
      action: 'Dismiss the reconnect prompt',
      trigger: 'toast button "Maybe later"',
      source: ['src/features/auth/GmailReauthenticationPrompt.tsx'],
    },
    {
      id: 'AX-040',
      surface: 'SX-12',
      action: 'Grant calendar access from the Enable calendar prompt',
      trigger: 'toast action "Grant access"',
      source: ['src/features/auth/CalendarPermissionPrompt.tsx'],
      flag: 'enable-calendar-ui, enable-calendar-prompt-web / enable-calendar-prompt-mobile',
    },
    {
      id: 'AX-209',
      surface: 'SX-12',
      action:
        'Dismiss the Enable calendar prompt (remembered, not shown again for that inbox)',
      trigger: 'toast button "Not now"',
      source: ['src/features/auth/CalendarPermissionPrompt.tsx'],
      flag: 'enable-calendar-ui, enable-calendar-prompt-web / enable-calendar-prompt-mobile',
    },
    {
      id: 'AX-041',
      surface: 'SX-13',
      action:
        'Retry from "Email access required" (opens the Add inbox dialog with the same scopes)',
      trigger: 'toast action "Try again"',
      source: ['src/features/auth/EmailAuth.tsx'],
      providers: ['gmail'],
    },
    {
      id: 'AX-210',
      surface: 'SX-13',
      action: 'Dismiss "Email access required"',
      trigger: 'toast button "Maybe later"',
      source: ['src/features/auth/EmailAuth.tsx'],
      providers: ['gmail'],
    },
    {
      id: 'AX-042',
      surface: 'SX-14',
      action: 'Onboarding: connect a Google account as work email',
      trigger:
        'button "Connect work email" ("Continue with Google" when Microsoft is also offered)',
      source: [
        'src/features/onboarding/components/google-accounts-step.tsx',
        'src/features/onboarding/views/email-step.tsx',
      ],
      providers: ['gmail'],
    },
    {
      id: 'AX-043',
      surface: 'SX-14',
      action: 'Onboarding: connect a Microsoft account',
      trigger: 'button "Continue with Microsoft"',
      source: [
        'src/features/onboarding/components/google-accounts-step.tsx',
        'src/features/onboarding/views/email-step.tsx',
      ],
      providers: ['outlook'],
    },
    {
      id: 'AX-211',
      surface: 'SX-14',
      action: 'Onboarding: reconnect a work email that needs re-auth',
      trigger: 'button "Reconnect work email"',
      source: ['src/features/onboarding/components/google-accounts-step.tsx'],
    },
    {
      id: 'AX-212',
      surface: 'SX-14',
      action: 'Onboarding: connect a second, personal email',
      trigger: 'button "Connect personal email"',
      source: ['src/features/onboarding/components/google-accounts-step.tsx'],
    },
    {
      id: 'AX-044',
      surface: 'SX-14',
      action: 'Onboarding: retry loading the connected accounts',
      trigger:
        'button "Try again" under "Couldn\'t load your connected accounts."',
      source: ['src/features/onboarding/components/google-accounts-step.tsx'],
    },
    {
      id: 'AX-213',
      surface: 'SX-14',
      action: 'Onboarding: continue past the email step',
      trigger: 'button "Continue" (or "Choose integrations")',
      source: ['src/features/onboarding/components/google-accounts-step.tsx'],
    },
    {
      id: 'AX-214',
      surface: 'SX-14',
      action: 'Onboarding: skip the email step',
      trigger: 'button "Skip for now"',
      source: ['src/features/onboarding/components/google-accounts-step.tsx'],
    },
    {
      id: 'AX-045',
      surface: 'SX-15',
      action: 'Mobile onboarding: add inbox',
      trigger: 'button "Connect Another Gmail"',
      source: ['src/features/mobile-onboarding/OnboardingConnectAccounts.tsx'],
    },
    {
      id: 'AX-215',
      surface: 'SX-16',
      action: 'Confirm sign out and remove local drafts',
      trigger: 'dialog button "Sign out"',
      source: ['src/lib/core/auth/logout.ts'],
    },
    {
      id: 'AX-216',
      surface: 'SX-16',
      action: 'Cancel sign out (drafts kept, session stays)',
      trigger: 'dialog "Cancel" / dismiss',
      source: ['src/lib/core/auth/logout.ts'],
    },
  ],
  states: [
    {
      id: 'STX-001',
      surface: 'SX-01',
      state: '"Loading accounts…"',
      trigger: 'links query pending',
      source: ['src/features/settings/email-settings.tsx'],
    },
    {
      id: 'STX-002',
      surface: 'SX-01',
      state: '"Couldn\'t load accounts" + Try again',
      trigger: 'GET /email/links failed',
      source: ['src/features/settings/email-settings.tsx'],
    },
    {
      id: 'STX-003',
      surface: 'SX-01',
      state: '"Loading signatures…" / "Loading signature…"',
      trigger: 'links query pending',
      source: ['src/features/settings/email-settings.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-004',
      surface: 'SX-01',
      state: '"Couldn\'t load signatures" + Try again',
      trigger: 'GET /email/links failed',
      source: ['src/features/settings/email-settings.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-005',
      surface: 'SX-01',
      state: '"Connect an email account above to add a signature."',
      trigger: 'no linked inbox',
      source: ['src/features/settings/email-settings.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-006',
      surface: 'SX-01',
      state: '"Connect an email account above to use read receipts."',
      trigger: 'no linked inbox',
      source: ['src/features/settings/email-settings.tsx'],
      flag: 'enable-email-read-receipts',
    },
    {
      id: 'STX-007',
      surface: 'SX-01',
      state:
        'Inbox row sync status: "Syncing…", "Error — re-sync", "Reconnect to resume sync", "Disabled" (nothing when up to date)',
      trigger: 'link.sync_status other than UP_TO_DATE',
      source: ['src/features/settings/Email.tsx'],
      flag: 'ENABLE_INBOX_SYNC_STATUS',
    },
    {
      id: 'STX-008',
      surface: 'SX-01',
      state:
        'Backfill progress bar "Backfilling…", "N of M threads", "~Xm left"',
      trigger: 'backfill_progress events from the connection gateway',
      source: [
        'src/features/settings/Email.tsx',
        'src/lib/queries/email/sync.ts',
      ],
      flag: 'ENABLE_INBOX_SYNC_STATUS',
    },
    {
      id: 'STX-009',
      surface: 'SX-01',
      state:
        'Inbox row: provider label "Gmail" or "Outlook / Microsoft 365" with "Beta" badge; chips "Primary", "Shared"; disabled primary row "Primary", "Disabled", "Sync disabled"',
      trigger: 'link fields',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'STX-200',
      surface: 'SX-01',
      state:
        'Connect rows hidden once an inbox is connected without enable-multi-inbox; Outlook row hidden when not offered',
      trigger: 'one inbox linked, flag off; providers endpoint without outlook',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'STX-201',
      surface: 'SX-01',
      state: 'Force sync button disabled while the inbox is syncing',
      trigger: 'resync pending or sync_status SYNCING',
      source: ['src/features/settings/Email.tsx'],
      flag: 'ENABLE_INBOX_RESYNC',
    },
    {
      id: 'STX-010',
      surface: 'SX-01',
      state:
        'Toast "Inbox removed" / "Failed to remove inbox. Please try again."',
      trigger: 'DELETE /email/links/{id} result',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'STX-011',
      surface: 'SX-01',
      state:
        'Toast "Re-sync started" / "Sync already in progress" / "Failed to start re-sync"',
      trigger: 'POST resync result',
      source: ['src/features/settings/Email.tsx'],
      flag: 'ENABLE_INBOX_RESYNC',
    },
    {
      id: 'STX-012',
      surface: 'SX-01',
      state: 'Toast "New Outlook connections are temporarily unavailable."',
      trigger: 'providers endpoint says outlook=false at click',
      source: ['src/features/settings/Email.tsx'],
      providers: ['outlook'],
    },
    {
      id: 'STX-013',
      surface: 'SX-01',
      state: 'Toast "Failed to update read receipts."',
      trigger: 'PATCH /email/settings failed',
      source: ['src/features/settings/email-settings.tsx'],
      flag: 'enable-email-read-receipts',
    },
    {
      id: 'STX-202',
      surface: 'SX-01',
      state: 'toast: "Inbox synced"',
      trigger: 'backfill_progress event reporting the backfill complete',
      source: ['src/lib/queries/email/sync.ts'],
      toasts: ['src/lib/queries/email/sync.ts#Inbox synced'],
      flag: 'ENABLE_INBOX_SYNC_STATUS',
    },
    {
      id: 'STX-203',
      surface: 'SX-01',
      state: 'toast: "Inbox sync failed"',
      trigger: 'legacy backfill event with status failed',
      source: ['src/lib/queries/email/sync.ts'],
      toasts: ['src/lib/queries/email/sync.ts#Inbox sync failed'],
      flag: 'ENABLE_INBOX_SYNC_STATUS',
    },
    {
      id: 'STX-204',
      surface: 'SX-02',
      state:
        'Dialog "Remove inbox": own inbox text vs shared "Remove access to … The inbox and its data stay with its owner."',
      trigger: 'Remove on an own inbox / on an inbox shared with the user',
      source: ['src/features/settings/Email.tsx'],
    },
    {
      id: 'STX-205',
      surface: 'SX-03',
      state:
        'Button "Turning off…" with status "Turning off calendar and removing synced events…"',
      trigger: 'turn-off request pending',
      source: ['src/features/calendar/components/TurnOffCalendarDialog.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'STX-014',
      surface: 'SX-03',
      state:
        'Toast "Calendar turned off" / "Failed to turn off calendar. Please try again."',
      trigger: 'turn-off result',
      source: ['src/features/calendar/components/TurnOffCalendarDialog.tsx'],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'STX-015',
      surface: 'SX-04',
      state:
        'Toasts "Signature saved", "Signature removed", "Failed to update setting.", "Failed to remove signature. Please try again."',
      trigger: 'PATCH /email/settings result',
      source: ['src/features/settings/SignatureSection.tsx'],
      viewports: BOTH_VIEWPORTS,
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-206',
      surface: 'SX-04',
      state:
        'Inline error "Failed to save signature. Please try again." / "Unable to save images. Add accessible image URLs in HTML, or use the image button in Rich text."; button "Saving…"',
      trigger: 'save pending / failed / images that cannot be stored',
      source: [
        'src/features/settings/SignatureSection.tsx',
        'src/features/settings/components/signature-form.tsx',
      ],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-016',
      surface: 'SX-04',
      state:
        'Toasts "Signature imported from Gmail", "No signature found in Gmail", "Failed to import signature. Please try again."; inline "Couldn\'t import images from your Gmail signature. …"; button "Importing…"',
      trigger: 'import result',
      source: [
        'src/features/settings/SignatureSection.tsx',
        'src/features/settings/components/signature-form.tsx',
      ],
      providers: ['gmail'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-017',
      surface: 'SX-04',
      state: 'Toast "Failed to upload image"',
      trigger: 'static upload failed',
      source: ['src/features/settings/SignatureEditor.tsx'],
      flag: 'enable-email-signatures',
      needs: 'the static file service',
    },
    {
      id: 'STX-207',
      surface: 'SX-04',
      state:
        'Preview tab: rendered signature, or "Write in Rich text or paste your HTML." when empty',
      trigger: 'Preview tab with / without a signature',
      source: ['src/features/settings/components/signature-workspace.tsx'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-208',
      surface: 'SX-04',
      state:
        'Shared inbox description "Shared inbox. Automatically added to new emails anyone sends from this account."',
      trigger: 'signature of an inbox shared with the user',
      source: ['src/features/settings/components/signature-form.tsx'],
      viewports: BOTH_VIEWPORTS,
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-018',
      surface: 'SX-04',
      state:
        'Touch layout: preview only ("No signature saved." when empty) with "Update your signature on desktop."; no tabs, Save or Import',
      trigger: 'phone width on a touch device (isMobile)',
      source: [
        'src/features/settings/components/signature-workspace.tsx',
        'src/features/settings/components/signature-form.tsx',
      ],
      viewports: ['phone'],
      flag: 'enable-email-signatures',
    },
    {
      id: 'STX-019',
      surface: 'SX-05',
      state:
        'Operation line "Create label “x”" / "Delete label “x”" / "Block x" / "Unblock x" with "Waiting for mailbox confirmation." or "Waiting to retry. Check that this inbox is connected and the change is allowed in your mailbox."',
      trigger:
        'GET /email/settings/operations (polled every 5 s) returns pending / failed operations',
      source: [
        'src/features/settings/InboxSettingsOperations.tsx',
        'src/features/settings/queries/inbox-settings-operations.ts',
      ],
    },
    {
      id: 'STX-209',
      surface: 'SX-06',
      state:
        'Dialog "Connect email" with "Gmail", "Outlook / Microsoft 365" + "Beta" badge, "Cancel"; skipped (straight to Google) when Outlook is not offered',
      trigger: 'connect without a provider',
      source: [
        'src/lib/core/email-link/ProviderDialog.tsx',
        'src/lib/core/email-link/index.ts',
      ],
    },
    {
      id: 'STX-023',
      surface: 'SX-06',
      state:
        'toast: "Failed to start inbox connection"; "Too many inbox connections in progress." on 429',
      trigger: 'POST /auth/link/gmail|outlook failed',
      source: ['src/lib/core/email-link/index.ts'],
      toasts: [
        'src/lib/core/email-link/index.ts#Failed to start inbox connection',
        'src/lib/core/email-link/index.ts#TOO_MANY_PENDING_LINKS_MESSAGE',
      ],
    },
    {
      id: 'STX-025',
      surface: 'SX-06',
      state: 'Multi-inbox paywall',
      trigger: '402 from POST /auth/link/gmail|outlook',
      source: ['src/lib/core/email-link/index.ts'],
    },
    {
      id: 'STX-210',
      surface: 'SX-06',
      state:
        'toast: "Failed to add inbox" (mobile app) / "Failed to open the browser to connect your account. Please try again." (desktop app)',
      trigger: 'native link completion failed / system browser failed to open',
      source: ['src/lib/core/email-link/index.ts'],
      toasts: [
        'src/lib/core/email-link/index.ts#Failed to add inbox',
        'src/lib/core/email-link/index.ts#Failed to open the browser to connect your account. Please try again.',
      ],
      waiver: {
        kind: 'native-only',
        reason:
          'Both toasts are raised only on the Tauri link paths (native auth session and system-browser open).',
      },
    },
    {
      id: 'STX-211',
      surface: 'SX-08',
      state: '"Finishing account connection…" with "Back to app"',
      trigger: 'callback route while the inbox is being initialised',
      source: ['src/features/auth/EmailAuth.tsx'],
    },
    {
      id: 'STX-020',
      surface: 'SX-08',
      state: 'toast: "Account connected"',
      trigger: 'init succeeded with a new inbox',
      source: ['src/lib/core/email-link/link-outcome.ts'],
      toasts: ['src/lib/core/email-link/link-outcome.ts#Account connected'],
    },
    {
      id: 'STX-021',
      surface: 'SX-08',
      state:
        'toast: "<address> is already connected" + hint to choose a different Google / Microsoft account',
      trigger:
        'AlreadyInitialized, or the chooser returned an already-linked account',
      source: ['src/lib/core/email-link/link-outcome.ts'],
      toasts: [
        'src/lib/core/email-link/link-outcome.ts#${emailAddress} is already connected',
      ],
    },
    {
      id: 'STX-022',
      surface: 'SX-08',
      state:
        'toast: "Account not connected" with "Sign-in was cancelled before access was granted."',
      trigger: 'consent cancelled (web: email_link_error=cancelled)',
      source: [
        'src/lib/core/email-link/link-outcome.ts',
        'src/features/auth/EmailAuth.tsx',
      ],
      toasts: ['src/lib/core/email-link/link-outcome.ts#Account not connected'],
    },
    {
      id: 'STX-024',
      surface: 'SX-08',
      state:
        'Toasts "Gmail access was not granted. Please allow all requested permissions and try again.", "A professional subscription is required to add another inbox.", "Failed to add inbox", "Failed to finish connecting your account. Please try again from Settings.", "Failed to connect your account. Please try again.", "Missing link id in callback URL"',
      trigger:
        'init errors (NoGmailGrant, PaymentRequired, other), thrown error, email_link_error other than cancelled, missing link_id',
      source: ['src/features/auth/EmailAuth.tsx'],
    },
    {
      id: 'STX-027',
      surface: 'SX-08',
      state: 'Toast "Approved. Try connecting again."',
      trigger: 'email_link_notice=admin_consent_granted',
      source: ['src/features/auth/EmailAuth.tsx'],
      providers: ['outlook'],
    },
    {
      id: 'STX-212',
      surface: 'SX-100',
      state:
        'Toast "Failed to connect email" with "Select email permissions on sign-in to enable"; other failures toast the error message',
      trigger: 'sign-up callback without email permissions / with an error',
      source: ['src/features/auth/EmailAuth.tsx', 'src/routes/pages.tsx'],
    },
    {
      id: 'STX-026',
      surface: 'SX-09',
      state:
        'Dialog "Admin approval required"; copy button disabled with "The approval link is unavailable right now. Try again later or connect a different account."; toasts "Admin approval link copied" / "Could not copy link"',
      trigger: 'Outlook tenant requires admin consent',
      source: ['src/features/inbox/AdminConsentRequiredDialog.tsx'],
      providers: ['outlook'],
    },
    {
      id: 'STX-213',
      surface: 'SX-10',
      state: 'Dialog "Share this inbox?" with "Cancel", "Share inbox"',
      trigger: 'init returned SharedInboxConflict',
      source: [
        'src/features/inbox/ShareInboxConflictDialog.tsx',
        'src/features/auth/EmailAuth.tsx',
      ],
    },
    {
      id: 'STX-028',
      surface: 'SX-11',
      state:
        'Persistent toast "Reconnect inbox" / "Reconnect email and calendar": "Sync stopped for <address>. Reconnect to restore email [and calendar] sync."',
      trigger:
        'link needs re-auth (found by the inbox health probe on mount and focus)',
      source: [
        'src/features/auth/GmailReauthenticationPrompt.tsx',
        'src/components/app/Layout.tsx',
      ],
    },
    {
      id: 'STX-029',
      surface: 'SX-12',
      state:
        'Persistent toast "Enable calendar": "Macro can now sync your calendar. Grant calendar access for <address> to turn it on."',
      trigger: 'own inbox with needs_calendar_permission, not dismissed before',
      source: ['src/features/auth/CalendarPermissionPrompt.tsx'],
      flag: 'enable-calendar-ui, enable-calendar-prompt-web / enable-calendar-prompt-mobile',
    },
    {
      id: 'STX-030',
      surface: 'SX-13',
      state:
        'Persistent toast "Email access required": "Macro connects an account\'s email and calendar together, so keep the email permissions checked. The account was not connected."',
      trigger: 'email_link_error=gmail_not_granted',
      source: ['src/features/auth/EmailAuth.tsx'],
      providers: ['gmail'],
    },
    {
      id: 'STX-214',
      surface: 'SX-14',
      state:
        'Onboarding status: "Work email connected" / personal address; buttons "Checking connection…", "Opening Google…", "Opening Microsoft…"; error "Couldn\'t load your connected accounts."',
      trigger: 'links query pending / loaded / failed; consent opening',
      source: ['src/features/onboarding/components/google-accounts-step.tsx'],
    },
    {
      id: 'STX-031',
      surface: 'SX-16',
      state:
        'Dialog "Sign out and remove local drafts?" with "N draft(s) have changes saved only on this device…", "Pending sends remain saved for this account…", or "Draft storage could not be checked…"',
      trigger:
        'sign out with unsynced drafts / queued sends / unreadable storage',
      source: ['src/lib/core/auth/logout.ts'],
    },
  ],
} as const satisfies Group;
