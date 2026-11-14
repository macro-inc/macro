// Menus and toolbars that act on threads: commands, bulk actions, the thread header, sharing, reminders.

import { BOTH_VIEWPORTS, type Group } from './types';

export const organise = {
  name: 'organise',
  surfaces: [
    {
      id: 'SL-25',
      name: 'Row action menu (right-click context menu; long-press drawer on phone)',
      opened: 'Right-click a row; long-press a row on a phone',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-140',
      name: 'Command menu in entity-action mode ("Search actions...")',
      opened:
        'Cmd+K with rows selected; row lightning button; selection toolbar Actions',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-26',
      name: 'Selection toolbar (bulk)',
      opened: 'Select rows with x / checkbox / shift+arrows',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-30',
      name: 'Thread header action groups (unread/done/remind, prev/next, Ask Macro/Create task, Share/copy link, side-panel toggle)',
      opened: 'Top right of open thread (desktop)',
      viewports: ['desktop'],
    },
    {
      id: 'SL-31',
      name: 'Thread title menu (⋯ after subject; sheet on touch)',
      opened: 'Click ⋯ / tap subject on touch',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-32',
      name: 'Thread side panel (Tags, Properties, Activity, References, metadata) / mobile Info sheet',
      opened: 'Side-panel toggle; mobile header Info',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-33',
      name: 'Share dialog (People/access)',
      opened: 'Share button, Cmd+S, title menu Share, row menu Share',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-45',
      name: 'Remind me menu (command-menu dialog)',
      opened:
        'H, header bell, title menu Remind me, row menu Remind me, row swipe right, Reminders row clock',
      viewports: BOTH_VIEWPORTS,
    },
  ],
  actions: [
    // SL-25 row action menu
    {
      id: 'AL-604',
      surface: 'SL-25',
      fn: ['F-179'],
      action: 'open row context menu',
      trigger: 'right-click a row',
      source: ['src/features/soup/SoupEntityContextMenu.tsx'],
      viewports: ['desktop'],
    },
    {
      id: 'AL-605',
      surface: 'SL-25',
      fn: ['F-179'],
      action: 'open row actions drawer',
      trigger: 'long-press a row',
      source: [
        'src/features/soup/SoupEntityActionDrawerManager.tsx',
        'src/features/soup/SoupEntityActionDrawer.tsx',
      ],
      viewports: ['phone'],
      note: 'isMobile(): width < 640 and a touch device',
    },
    {
      id: 'AL-078',
      surface: 'SL-25',
      fn: ['F-071', 'F-072'],
      action: 'Mark Done / Mark Not Done',
      trigger: 'row menu item (tabs that support done)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-mark-done-action.ts',
        'src/features/next-soup/actions/make-mark-not-done-action.ts',
      ],
    },
    {
      id: 'AL-079',
      surface: 'SL-25',
      fn: ['F-068', 'F-069'],
      action: 'Mark Read / Mark Unread',
      trigger: 'row menu item (Mark Read when any selected row is unread)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-mark-unread-action.ts',
      ],
    },
    {
      id: 'AL-080',
      surface: 'SL-25',
      fn: ['F-073', 'F-074'],
      action: 'Favorite / Unfavorite',
      trigger: 'row menu item',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-favorite-action.ts',
      ],
    },
    {
      id: 'AL-081',
      surface: 'SL-25',
      fn: ['F-079'],
      action: 'Mute notifications (pick a duration) / Unmute notifications',
      trigger:
        'row menu item; submenu "Until I turn it off", timed presets, "Custom…" (a sub page in the phone drawer)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-mute-action.ts',
      ],
      needs: 'the notification service',
    },
    {
      id: 'AL-082',
      surface: 'SL-25',
      fn: ['F-090'],
      action: 'Remind me',
      trigger: 'row menu item (single row)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-create-reminder-action.ts',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-083',
      surface: 'SL-25',
      fn: ['F-084'],
      action: 'Add tag (tag picker)',
      trigger: 'context menu item (single row)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/soup/SoupEntityContextMenu.tsx',
      ],
      viewports: ['desktop'],
      note: 'the tag picker is only given to the context menu, not the phone drawer',
    },
    {
      id: 'AL-084',
      surface: 'SL-25',
      fn: ['F-065'],
      action: 'Copy Link',
      trigger: 'row menu item (single row)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-copy-link-action.ts',
      ],
    },
    {
      id: 'AL-603',
      surface: 'SL-25',
      fn: ['F-187'],
      action: 'Copy ID',
      trigger: 'row menu item (single row)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-copy-entity-id-action.ts',
      ],
    },
    {
      id: 'AL-085',
      surface: 'SL-25',
      fn: ['F-158'],
      action: 'Share (opens the Share dialog)',
      trigger: 'row menu item',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-share-action.ts',
      ],
      flag: 'ENABLE_EMAIL_SHARING',
    },
    {
      id: 'AL-086',
      surface: 'SL-25',
      fn: ['F-081'],
      action: 'Sender → Signal',
      trigger: 'row menu item (row in the Noise bucket)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-sender-filter-action.ts',
        'src/lib/queries/email/thread.ts',
      ],
    },
    {
      id: 'AL-087',
      surface: 'SL-25',
      fn: ['F-081'],
      action: 'Sender → Noise',
      trigger: 'row menu item (row in the Signal bucket)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-sender-filter-action.ts',
        'src/lib/queries/email/thread.ts',
      ],
    },
    {
      id: 'AL-088',
      surface: 'SL-25',
      fn: ['F-080'],
      action: 'Block Sender (multi-select blocks per linked inbox)',
      trigger: 'row menu item (row with a sender address)',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-block-sender-action.ts',
        'src/lib/queries/email/thread.ts',
      ],
    },
    {
      id: 'AL-089',
      surface: 'SL-25',
      fn: ['F-075'],
      action: 'Delete (move to Trash, no confirmation)',
      trigger: 'row menu item',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-delete-action.ts',
      ],
    },
    {
      id: 'AL-090',
      surface: 'SL-25',
      fn: ['F-054'],
      action: 'Open in new split',
      trigger: 'context menu item (single row not already open in a split)',
      source: ['src/features/soup/createSoupEntityActions.ts'],
      viewports: ['desktop'],
    },
    {
      id: 'AL-602',
      surface: 'SL-25',
      fn: ['F-054'],
      action: 'Open in new tab',
      trigger: 'context menu item',
      source: ['src/features/soup/createSoupEntityActions.ts'],
      viewports: ['desktop'],
      flag: 'enable-desktop-tabs',
      waiver: {
        kind: 'native-only',
        reason:
          'The item only shows when the desktop app has tabs, which a browser never has.',
      },
    },
    {
      id: 'AL-091',
      surface: 'SL-25',
      fn: ['F-087'],
      action: 'Move to folder',
      trigger: 'row menu item (threads the viewer owns)',
      source: ['src/features/soup/createSoupEntityActions.ts'],
    },
    {
      id: 'AL-607',
      surface: 'SL-25',
      fn: ['F-071'],
      action: 'archive hotkey token',
      trigger: 'none: the token is declared but nothing registers or shows it',
      source: ['src/lib/core/hotkey/tokens.ts'],
      registered: ['email.archive'],
      viewports: ['desktop'],
      waiver: {
        kind: 'no-user-path',
        reason:
          'The email.archive token is only declared; no hotkey, menu item or tooltip uses it.',
      },
    },

    // SL-140 command menu in entity-action mode
    {
      id: 'AL-076',
      surface: 'SL-140',
      fn: ['F-179'],
      action: 'open command menu for the selected rows',
      trigger: 'hotkey Cmd+K with a selection (toggles it)',
      source: ['src/features/email-view/use-email-list-hotkeys.ts'],
      registered: ['global.commandMenu'],
      viewports: ['desktop'],
    },
    {
      id: 'AL-600',
      surface: 'SL-140',
      fn: ['F-179'],
      action: 'open command menu for one row',
      trigger: 'row lightning button "Open command menu"',
      source: [
        'src/features/email-view/components/EmailRowActions.tsx',
        'src/features/email-view/components/EmailList.tsx',
      ],
    },
    {
      id: 'AL-601',
      surface: 'SL-140',
      fn: ['F-082'],
      action:
        'run a selection action (Mark done, Mark read/unread, Remind me, ...)',
      trigger: 'type in "Search actions...", pick an item',
      source: [
        'src/features/command/useCommandItems.ts',
        'src/features/command/CommandMenu.tsx',
        'src/features/next-soup/actions/use-entity-action-hotkeys.ts',
      ],
    },
    {
      id: 'AL-608',
      surface: 'SL-140',
      fn: ['F-073', 'F-074'],
      action: 'Favorite / Unfavorite the selection',
      trigger: 'command menu item (the list’s S command)',
      source: [
        'src/features/next-soup/actions/use-entity-action-hotkeys.ts',
        'src/features/email-view/components/EmailList.tsx',
      ],
      registered: ['email.star'],
    },
    {
      id: 'AL-610',
      surface: 'SL-140',
      fn: ['F-079'],
      action: 'Mute / Unmute the selection',
      trigger: 'command menu item (the list’s Shift+M command)',
      source: [
        'src/features/next-soup/actions/use-entity-action-hotkeys.ts',
        'src/features/email-view/components/EmailList.tsx',
      ],
      registered: ['email.mute'],
      needs: 'the notification service',
    },
    {
      id: 'AL-611',
      surface: 'SL-140',
      fn: ['F-075'],
      action: 'Delete the selection (move to Trash)',
      trigger: 'command menu item (the Shift+3 / Delete / Backspace command)',
      source: ['src/features/next-soup/actions/use-entity-action-hotkeys.ts'],
      registered: ['email.trash'],
    },

    // SL-26 selection toolbar
    {
      id: 'AL-056',
      surface: 'SL-26',
      fn: ['F-039'],
      action: 'clear selection',
      trigger: 'toolbar X button / "Clear" button',
      source: [
        'src/features/entity/EntitySelectionToolbar.tsx',
        'src/features/email-view/components/EmailList.tsx',
      ],
    },
    {
      id: 'AL-092',
      surface: 'SL-26',
      fn: ['F-082'],
      action: 'open the command menu for the selection',
      trigger: 'toolbar "Actions" button (⌘K hint)',
      source: [
        'src/features/entity/EntitySelectionToolbar.tsx',
        'src/features/email-view/components/EmailList.tsx',
      ],
      note: 'bulk done / read / star / delete run from that menu (SL-140); the toolbar has no per-action buttons',
    },
    {
      id: 'AL-095',
      surface: 'SL-26',
      fn: ['F-078', 'F-076'],
      action: 'bulk Not spam / Restore',
      trigger: 'toolbar "Not spam" (Spam) / "Restore" (Trash) button',
      source: ['src/features/email-view/components/EmailList.tsx'],
      note: 'as AL-093/094',
    },

    // SL-30 thread header
    {
      id: 'AL-125',
      surface: 'SL-30',
      fn: ['F-061'],
      action: 'next / previous item',
      trigger: 'header "Previous item" / "Next item" arrows',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/components/app/split-layout/components/SplitHeader.tsx',
      ],
      note: 'only when the thread was opened from a list that gives navigation',
    },
    {
      id: 'AL-126',
      surface: 'SL-30',
      fn: ['F-068', 'F-069'],
      action: 'mark as unread / read toggle',
      trigger: 'header envelope button "Mark as unread" / "Mark as read"',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/features/email-thread/thread-read-adapter.ts',
      ],
    },
    {
      id: 'AL-127',
      surface: 'SL-30',
      fn: ['F-071', 'F-072'],
      action: 'mark done / not done toggle',
      trigger: 'header check button "Mark done" / "Mark as not done"',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/features/email-thread/thread-completion-adapter.tsx',
      ],
    },
    {
      id: 'AL-128',
      surface: 'SL-30',
      fn: ['F-090'],
      action: 'open Remind me',
      trigger: 'header bell button "Remind me"',
      source: ['src/features/reminders/email-reminder-status.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-129',
      surface: 'SL-30',
      fn: ['F-167'],
      action: 'Ask Macro',
      trigger: 'header "Ask Macro" button',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/features/chat/ChatWithAgentButton.tsx',
      ],
      needs: 'the AI service',
    },
    {
      id: 'AL-130',
      surface: 'SL-30',
      fn: ['F-167'],
      action: 'Create task (task composer mentioning the thread)',
      trigger: 'header "Create task" button',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/features/block-email/EmailThreadHostView.tsx',
      ],
    },
    {
      id: 'AL-131',
      surface: 'SL-30',
      fn: ['F-158'],
      action: 'open Share dialog',
      trigger: 'header "Share" button',
      source: [
        'src/lib/core/component/TopBar/ShareButton.tsx',
        'src/features/email-view/components/EmailDetailView.tsx',
        'src/features/block-email/views/email-thread.tsx',
      ],
      flag: 'ENABLE_EMAIL_SHARING',
    },
    {
      id: 'AL-612',
      surface: 'SL-30',
      fn: ['F-158'],
      action: 'open Share dialog',
      trigger: 'hotkey Cmd+S',
      source: ['src/lib/core/component/TopBar/ShareButton.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
      note: 'token block.share, registered by the Share button; not in the derived hotkey list',
    },
    {
      id: 'AL-196',
      surface: 'SL-30',
      fn: ['F-065'],
      action: 'copy thread link',
      trigger: 'header "Copy Share Link" button beside Share',
      source: [
        'src/lib/core/component/TopBar/ShareButton.tsx',
        'src/lib/core/util/useCopyLink.ts',
      ],
      flag: 'ENABLE_EMAIL_SHARING',
    },
    {
      id: 'AL-132',
      surface: 'SL-30',
      fn: ['F-188'],
      action: 'toggle side panel',
      trigger: 'header "Show details" / "Hide details" button',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/components/app/side-panel/SidePanel.tsx',
      ],
    },

    // SL-31 thread title menu
    {
      id: 'AL-148',
      surface: 'SL-31',
      fn: ['F-179'],
      action: 'open title menu',
      trigger: 'click ⋯ after subject (tap subject on touch: bottom sheet)',
      source: [
        'src/components/app/split-layout/components/SplitFileMenu.tsx',
        'src/features/email-view/components/EmailDetailView.tsx',
        'src/features/block-email/views/mobile/email-thread.tsx',
      ],
    },
    {
      id: 'AL-149',
      surface: 'SL-31',
      fn: ['F-158'],
      action: 'Share',
      trigger: 'title menu',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
    },
    {
      id: 'AL-150',
      surface: 'SL-31',
      fn: ['F-071', 'F-072'],
      action: 'Mark Done / Mark Not Done',
      trigger: 'title menu (own thread)',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
    },
    {
      id: 'AL-151',
      surface: 'SL-31',
      fn: ['F-068', 'F-069'],
      action: 'Mark Unread / Mark Read',
      trigger: 'title menu',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
    },
    {
      id: 'AL-152',
      surface: 'SL-31',
      fn: ['F-167'],
      action: 'Ask Macro',
      trigger: 'title menu',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
      needs: 'the AI service',
    },
    {
      id: 'AL-153',
      surface: 'SL-31',
      fn: ['F-167'],
      action: 'Create task',
      trigger: 'title menu',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
    },
    {
      id: 'AL-154',
      surface: 'SL-31',
      fn: ['F-114'],
      action: 'Create event (event composer with the thread’s participants)',
      trigger: 'title menu "Create event"',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/features/block-email/EmailThreadHostView.tsx',
        'src/features/email-compose/email-event.ts',
      ],
      flag: 'enable-calendar-ui',
    },
    {
      id: 'AL-155',
      surface: 'SL-31',
      fn: ['F-087'],
      action: 'Move to folder',
      trigger: 'title menu (own thread)',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
    },
    {
      id: 'AL-156',
      surface: 'SL-31',
      fn: ['F-064'],
      action: 'Download .eml',
      trigger: 'title menu (thread with a downloadable message)',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/features/email-message/eml-download-adapter.ts',
      ],
    },
    {
      id: 'AL-157',
      surface: 'SL-31',
      fn: ['F-075'],
      action: 'Delete (move to Trash)',
      trigger: 'title menu "Delete" (own thread)',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
    },
    {
      id: 'AL-158',
      surface: 'SL-31',
      fn: ['F-081'],
      action: 'Sender → Signal',
      trigger: 'title menu (own thread, sender in Noise)',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/lib/queries/email/thread.ts',
      ],
    },
    {
      id: 'AL-159',
      surface: 'SL-31',
      fn: ['F-081'],
      action: 'Sender → Noise',
      trigger: 'title menu (own thread, sender in Signal)',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/lib/queries/email/thread.ts',
      ],
    },
    {
      id: 'AL-160',
      surface: 'SL-31',
      fn: ['F-080'],
      action: 'Block Sender',
      trigger: 'title menu',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/lib/queries/email/thread.ts',
      ],
    },
    {
      id: 'AL-161',
      surface: 'SL-31',
      fn: ['F-090'],
      action: 'Remind me',
      trigger: 'title menu',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-613',
      surface: 'SL-31',
      fn: ['F-073', 'F-074'],
      action: 'Favorite / Unfavorite',
      trigger: 'title menu',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
    },
    {
      id: 'AL-614',
      surface: 'SL-31',
      fn: ['F-079'],
      action: 'Mute notifications (pick a duration) / Unmute notifications',
      trigger: 'title menu submenu (a sub page in the touch sheet)',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
      needs: 'the notification service',
    },
    {
      id: 'AL-615',
      surface: 'SL-31',
      fn: ['F-084'],
      action: 'Add tag',
      trigger: 'title menu',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
    },
    {
      id: 'AL-616',
      surface: 'SL-31',
      fn: ['F-065'],
      action: 'Copy Link',
      trigger: 'title menu',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
    },
    {
      id: 'AL-617',
      surface: 'SL-31',
      fn: ['F-187'],
      action: 'Copy ID',
      trigger: 'title menu',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
    },
    {
      id: 'AL-162',
      surface: 'SL-31',
      fn: ['F-178'],
      action: 'copy subject',
      trigger: '"Copy subject" button beside the title',
      source: [
        'src/features/email-thread/components/copy-subject-button.tsx',
        'src/features/email-thread/components/email-thread-title.tsx',
      ],
      note: 'shown only where the title has no menu mounted after it',
    },

    // SL-32 side panel
    {
      id: 'AL-193',
      surface: 'SL-32',
      fn: ['F-084', 'F-088'],
      action: 'edit tags / properties of the thread',
      trigger: 'side panel Tags and Properties sections (thread owner)',
      source: [
        'src/features/block-email/component/sidepanel/EmailSidePanelSections.tsx',
      ],
    },
    {
      id: 'AL-618',
      surface: 'SL-32',
      fn: ['F-188'],
      action: 'open thread details sheet',
      trigger: 'mobile header Info button',
      source: [
        'src/features/block-email/views/mobile/email-thread.tsx',
        'src/components/app/side-panel/SidePanel.tsx',
      ],
      viewports: ['phone'],
    },

    // SL-33 share dialog
    {
      id: 'AL-195',
      surface: 'SL-33',
      fn: ['F-158'],
      action: 'share the thread with people or channels at Can edit / Can view',
      trigger: 'Share dialog recipient field, access select, submit',
      source: ['src/lib/core/component/TopBar/ShareButton.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
      note: 'email offers view and edit only and starts on edit',
    },
    {
      id: 'AL-619',
      surface: 'SL-33',
      fn: ['F-158'],
      action: 'change or remove a recipient’s access',
      trigger: 'Share dialog roster access select / "Remove Access"',
      source: ['src/lib/core/component/TopBar/ShareButton.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
    },
    {
      id: 'AL-620',
      surface: 'SL-33',
      fn: ['F-065'],
      action: 'copy link from the dialog',
      trigger: 'Share dialog "Copy Link" (viewer who cannot share)',
      source: ['src/lib/core/component/TopBar/ShareButton.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
    },

    // SL-45 remind me menu
    {
      id: 'AL-186',
      surface: 'SL-45',
      fn: ['F-090'],
      action: 'pick a preset reminder time (saves at once)',
      trigger: 'click an option, or ↑/↓ then Enter',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-composer.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-621',
      surface: 'SL-45',
      fn: ['F-090'],
      action: 'type a natural-language time and save it',
      trigger: 'input "Remind me when" ("Type a time, like tomorrow 9am")',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-menu.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-187',
      surface: 'SL-45',
      fn: ['F-090'],
      action: 'choose condition If no reply / Regardless',
      trigger: 'footer "Reminder condition" tabs',
      source: ['src/features/reminders/components/email-reminder-form.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-188',
      surface: 'SL-45',
      fn: ['F-091'],
      action: 'Remove reminder',
      trigger: 'footer "Remove reminder" (thread with a reminder set)',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-composer.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-189',
      surface: 'SL-45',
      fn: ['F-090'],
      action: 'close without saving',
      trigger: 'footer "Cancel"',
      source: ['src/features/reminders/components/email-reminder-form.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-622',
      surface: 'SL-45',
      fn: ['F-090'],
      action: 'retry loading the reminder',
      trigger: 'footer "Retry" (after the reminder failed to load)',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-composer.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'AL-903',
      surface: 'SL-33',
      fn: ['F-160'],
      action: 'Request access to a thread',
      trigger: 'Share dialog "Request access"',
      source: [
        'src/lib/core/component/TopBar/ShareButton.tsx',
        'src/features/access-requests/views/RequestAccessView.tsx',
      ],
    },
    {
      id: 'AL-904',
      surface: 'SL-25',
      fn: ['F-196'],
      action: 'Unblock a sender',
      trigger: 'Undo on the "Sender block queued" toast',
      source: ['src/lib/queries/email/thread.ts'],
    },
    {
      id: 'AL-905',
      surface: 'SL-33',
      fn: ['F-160'],
      action: 'Grant or deny a request for access to a thread',
      trigger: 'Share dialog "Permission requests": "Grant access" / "Deny"',
      source: [
        'src/lib/core/component/TopBar/ShareButton.tsx',
        'src/features/access-requests/views/PermissionRequestsView.tsx',
      ],
    },
  ],
  states: [
    // SL-25 row action menu
    {
      id: 'STL-050',
      surface: 'SL-25',
      fn: ['F-080', 'F-083', 'F-196'],
      state:
        'toast "Sender block queued" + Undo; Undo shows "Sender unblock queued"',
      trigger: 'Block Sender',
      source: ['src/lib/queries/email/thread.ts'],
      toasts: [
        'src/lib/queries/email/thread.ts#Sender block queued',
        'src/lib/queries/email/thread.ts#Sender unblock queued',
      ],
    },
    {
      id: 'STL-600',
      surface: 'SL-25',
      fn: ['F-080'],
      state: 'toast "Failed to block sender" / "Failed to unblock sender"',
      trigger: 'block or its Undo fails',
      source: ['src/lib/queries/email/thread.ts'],
      toasts: [
        'src/lib/queries/email/thread.ts#Failed to block sender',
        'src/lib/queries/email/thread.ts#Failed to unblock sender',
      ],
    },
    {
      id: 'STL-051',
      surface: 'SL-25',
      fn: ['F-081', 'F-083'],
      state:
        'toast "Sender marked as Signal" / "Sender marked as Noise" + Undo; Undo shows "Sender filter removed"',
      trigger: 'Sender → Signal/Noise',
      source: ['src/lib/queries/email/thread.ts'],
      toasts: [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the toast's key as the source spells it
        'src/lib/queries/email/thread.ts#Sender marked as ${label}',
        'src/lib/queries/email/thread.ts#Sender filter removed',
      ],
    },
    {
      id: 'STL-601',
      surface: 'SL-25',
      fn: ['F-081'],
      state: 'toast "Failed to mark sender as <label>" / "Failed to undo"',
      trigger: 'sender filter or its Undo fails',
      source: ['src/lib/queries/email/thread.ts'],
      toasts: [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the toast's key as the source spells it
        'src/lib/queries/email/thread.ts#Failed to mark sender as ${label}',
        'src/lib/queries/email/thread.ts#Failed to undo',
      ],
    },
    {
      id: 'STL-602',
      surface: 'SL-25',
      fn: ['F-179'],
      state:
        'menu items follow the row: Mark Done only on tabs that support it, Sender → items only on Signal/Noise tabs, Move to folder only for own threads',
      trigger: 'open the row menu',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/entity-action-context.ts',
      ],
    },
    {
      id: 'STL-603',
      surface: 'SL-25',
      fn: ['F-054'],
      state: '"Open in new split" disabled when no split can be added',
      trigger: 'open the context menu with the layout full',
      source: ['src/features/soup/createSoupEntityActions.ts'],
      viewports: ['desktop'],
    },
    {
      id: 'STL-604',
      surface: 'SL-25',
      fn: ['F-065'],
      state: 'toast "Link copied to clipboard" / "ID copied to clipboard"',
      trigger: 'Copy Link / Copy ID',
      source: [
        'src/features/next-soup/actions/make-copy-link-action.ts',
        'src/features/next-soup/actions/make-copy-entity-id-action.ts',
      ],
    },
    {
      id: 'STL-605',
      surface: 'SL-25',
      fn: ['F-079'],
      state:
        'toast "Muted notifications" / "Unmuted notifications" / "Failed to mute notifications"',
      trigger: 'Mute / Unmute notifications',
      source: ['src/features/next-soup/actions/make-mute-action.ts'],
      needs: 'the notification service',
    },

    // SL-140 command menu in entity-action mode
    {
      id: 'STL-606',
      surface: 'SL-140',
      fn: ['F-179'],
      state:
        'menu lists only the actions for the selection, placeholder "Search actions..."',
      trigger: 'open the command menu for rows',
      source: [
        'src/features/command/CommandMenu.tsx',
        'src/features/command/useCommandItems.ts',
      ],
    },

    // SL-26 selection toolbar
    {
      id: 'STL-112',
      surface: 'SL-26',
      fn: ['F-039'],
      state:
        'toolbar "<n> selected" with X, Actions, Clear; "Not spam" in Spam, "Restore" in Trash',
      trigger: 'one or more rows selected',
      source: [
        'src/features/entity/EntitySelectionToolbar.tsx',
        'src/features/email-view/components/EmailList.tsx',
      ],
    },
    {
      id: 'STL-607',
      surface: 'SL-26',
      fn: ['F-076', 'F-078'],
      state: '"Not spam" / "Restore" button disabled while the restore runs',
      trigger: 'click the button',
      source: ['src/features/email-view/components/EmailList.tsx'],
    },

    // SL-30 thread header
    {
      id: 'STL-072',
      surface: 'SL-30',
      fn: ['F-068', 'F-069'],
      state:
        'unread toggle label "Mark as read" (accent closed envelope) / "Mark as unread"',
      trigger: 'thread read state',
      source: ['src/features/block-email/views/email-thread-parts.tsx'],
    },
    {
      id: 'STL-073',
      surface: 'SL-30',
      fn: ['F-071', 'F-072'],
      state: 'done toggle label "Mark as not done" / "Mark done"',
      trigger: 'thread archived state',
      source: ['src/features/block-email/views/email-thread-parts.tsx'],
    },
    {
      id: 'STL-608',
      surface: 'SL-30',
      fn: ['F-159'],
      state:
        'reminder, read and done controls only on own threads; done toggle hidden for a done send-only thread',
      trigger: 'open a shared thread / a done thread with only sent mail',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/features/block-email/views/email-thread-parts.tsx',
      ],
    },
    {
      id: 'STL-609',
      surface: 'SL-30',
      fn: ['F-068', 'F-069'],
      state: 'toast "Marked as unread" / "Marked as read"',
      trigger: 'unread toggle or title menu Mark Unread / Mark Read',
      source: ['src/features/email-thread/thread-read-adapter.ts'],
      toasts: [
        'src/features/email-thread/thread-read-adapter.ts#Marked as unread',
        'src/features/email-thread/thread-read-adapter.ts#Marked as read',
      ],
      note: 'hideOnMobile: not shown on a phone',
    },
    {
      id: 'STL-610',
      surface: 'SL-30',
      fn: ['F-068', 'F-069'],
      state: 'toast "Failed to mark as unread" / "Failed to mark as read"',
      trigger: 'the read-state request fails',
      source: ['src/features/email-thread/thread-read-adapter.ts'],
      toasts: [
        'src/features/email-thread/thread-read-adapter.ts#Failed to mark as unread',
        'src/features/email-thread/thread-read-adapter.ts#Failed to mark as read',
      ],
    },
    {
      id: 'STL-611',
      surface: 'SL-30',
      fn: ['F-069', 'F-177'],
      state: 'thread closes back to the list',
      trigger: 'mark unread in the inline thread view',
      source: ['src/features/email-view/components/EmailDetailView.tsx'],
    },
    {
      id: 'STL-612',
      surface: 'SL-30',
      fn: ['F-071', 'F-072', 'F-083'],
      state: 'toast "Marked as done" / "Marked as not done" + Undo',
      trigger: 'done toggle or title menu Mark Done / Mark Not Done',
      source: ['src/features/email-thread/thread-completion-adapter.tsx'],
      toasts: [
        'src/features/email-thread/thread-completion-adapter.tsx#message',
      ],
      note: 'hideOnMobile: not shown on a phone',
    },
    {
      id: 'STL-613',
      surface: 'SL-30',
      fn: ['F-071', 'F-072', 'F-083'],
      state:
        'toast "Failed to mark as done" / "Failed to mark as not done" / "Failed to undo"',
      trigger: 'the done request or its Undo fails',
      source: ['src/features/email-thread/thread-completion-adapter.tsx'],
      toasts: [
        'src/features/email-thread/thread-completion-adapter.tsx#Failed to mark as done',
        'src/features/email-thread/thread-completion-adapter.tsx#Failed to mark as not done',
        'src/features/email-thread/thread-completion-adapter.tsx#Failed to undo',
      ],
    },
    {
      id: 'STL-104',
      surface: 'SL-30',
      fn: ['F-090'],
      state:
        'bell labelled "Remind me"; accent bell labelled "Reminder set for <time>" when one is set',
      trigger: 'thread header',
      source: ['src/features/reminders/email-reminder-status.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-614',
      surface: 'SL-30',
      fn: ['F-061'],
      state: '"Previous item" / "Next item" disabled at the ends of the list',
      trigger: 'open the first or last thread of a list',
      source: ['src/components/app/split-layout/components/SplitHeader.tsx'],
    },
    {
      id: 'STL-615',
      surface: 'SL-30',
      fn: ['F-065'],
      state: 'toast "Link copied to clipboard." / "Could not copy link"',
      trigger: 'Copy Share Link',
      source: ['src/lib/core/util/useCopyLink.ts'],
    },

    // SL-31 thread title menu
    {
      id: 'STL-078',
      surface: 'SL-31',
      fn: ['F-075', 'F-083'],
      state:
        'toast "Moved to Trash" + Undo; Undo shows "Restored from Trash" or "Failed to restore from Trash"',
      trigger: 'Delete from title menu',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
      toasts: [
        'src/features/block-email/component/useEmailThreadTools.tsx#Moved to Trash',
        'src/features/block-email/component/useEmailThreadTools.tsx#Restored from Trash',
        'src/features/block-email/component/useEmailThreadTools.tsx#Failed to restore from Trash',
      ],
    },
    {
      id: 'STL-616',
      surface: 'SL-31',
      fn: ['F-075'],
      state: 'toast "Failed to move to Trash"',
      trigger: 'the trash request fails',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
      toasts: [
        'src/features/block-email/component/useEmailThreadTools.tsx#Failed to move to Trash',
      ],
    },
    {
      id: 'STL-617',
      surface: 'SL-31',
      fn: ['F-075', 'F-177'],
      state: 'thread closes (inline view returns to the list)',
      trigger: 'Delete from title menu',
      source: [
        'src/features/block-email/component/useEmailThreadTools.tsx',
        'src/features/email-view/components/EmailDetailView.tsx',
      ],
    },
    {
      id: 'STL-618',
      surface: 'SL-31',
      fn: ['F-159'],
      state:
        'a thread the viewer does not own has no Mark Done, Move to folder, Delete or Sender → items',
      trigger: 'open the title menu of a shared thread',
      source: ['src/features/block-email/component/useEmailThreadTools.tsx'],
    },
    {
      id: 'STL-619',
      surface: 'SL-31',
      fn: ['F-179'],
      state: 'menu shows as a bottom sheet without hotkey hints',
      trigger: 'open the title menu on a touch device',
      source: ['src/components/app/split-layout/components/SplitFileMenu.tsx'],
      viewports: ['phone'],
    },
    {
      id: 'STL-094',
      surface: 'SL-31',
      fn: ['F-064'],
      state: 'toast "Failed to download email. Please try again."',
      trigger: 'the .eml request fails',
      source: ['src/features/email-message/eml-download-adapter.ts'],
      toasts: [
        'src/features/email-message/eml-download-adapter.ts#entityActions.downloadEmlFailed',
      ],
    },
    {
      id: 'STL-108',
      surface: 'SL-31',
      fn: ['F-178'],
      state:
        '"Copy subject" button revealed on hovering the title; absent for an empty subject',
      trigger: 'hover title',
      source: [
        'src/features/email-thread/components/copy-subject-button.tsx',
        'src/features/email-thread/components/email-thread-title.tsx',
      ],
    },

    // SL-32 side panel
    {
      id: 'STL-109',
      surface: 'SL-32',
      fn: ['F-088'],
      state:
        'side panel sections Tags / Properties / Activity, created and updated dates in the footer',
      trigger: 'toggle side panel',
      source: [
        'src/features/block-email/component/sidepanel/EmailSidePanelSections.tsx',
      ],
    },
    {
      id: 'STL-620',
      surface: 'SL-32',
      fn: ['F-188'],
      state: 'References section with a count, only when the thread has any',
      trigger: 'open the panel on a thread referenced elsewhere',
      source: [
        'src/features/block-email/component/sidepanel/EmailSidePanelSections.tsx',
      ],
    },
    {
      id: 'STL-621',
      surface: 'SL-32',
      fn: ['F-084', 'F-088'],
      state: 'Tags and Properties read-only for a viewer who is not the owner',
      trigger: 'open the panel on a shared thread',
      source: [
        'src/features/block-email/component/sidepanel/EmailSidePanelSections.tsx',
      ],
    },
    {
      id: 'STL-982',
      surface: 'SL-23',
      fn: ['F-084'],
      state:
        'result: the row carries the tag as a chip, and loses it once the tag is taken off',
      trigger: 'after a tag is picked, or picked again, for the thread',
      source: ['src/features/property/tags/EntityRowTags.tsx'],
    },
    {
      id: 'STL-983',
      surface: 'SL-32',
      fn: ['F-088'],
      state:
        'result: the Properties section lists the property with the value chosen',
      trigger: 'after a property is added and its value picked',
      source: [
        'src/features/block-email/component/sidepanel/EmailSidePanelSections.tsx',
      ],
    },

    // SL-33 share dialog
    {
      id: 'STL-622',
      surface: 'SL-33',
      fn: ['F-158'],
      state:
        'roster "People with access to this …" with the owner; titled "Owner" for a viewer who is not the owner',
      trigger: 'open the Share dialog',
      source: ['src/lib/core/component/TopBar/ShareButton.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
    },
    {
      id: 'STL-623',
      surface: 'SL-33',
      fn: ['F-158'],
      state:
        'no link-sharing controls for email (no Link tab in the phone drawer)',
      trigger: 'open the Share dialog',
      source: ['src/lib/core/component/TopBar/ShareButton.tsx'],
      flag: 'ENABLE_EMAIL_SHARING',
    },

    // SL-45 remind me menu
    {
      id: 'STL-101',
      surface: 'SL-45',
      fn: ['F-090'],
      state:
        'input label "Remind me when", placeholder "Type a time, like tomorrow 9am", preset options with their times',
      trigger: 'open Remind me',
      source: ['src/features/reminders/components/email-reminder-form.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-102',
      surface: 'SL-45',
      fn: ['F-090'],
      state: 'condition tabs "If no reply" (default) / "Regardless"',
      trigger: 'open Remind me',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-menu.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-624',
      surface: 'SL-45',
      fn: ['F-091'],
      state: '"Scheduled for <time>" and the "Remove reminder" button',
      trigger: 'open Remind me on a thread with a reminder set',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-composer.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-625',
      surface: 'SL-45',
      fn: ['F-090'],
      state:
        'empty state "Enter a future time, like in 2 hours or tomorrow 9am." or the reason the text is not a time',
      trigger: 'type text that offers no time',
      source: [
        'src/features/reminders/components/email-reminder-form.tsx',
        'src/features/reminders/views/email-reminder-menu.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-626',
      surface: 'SL-45',
      fn: ['F-090'],
      state: 'status "Saving…", input, options and buttons disabled',
      trigger: 'while the reminder request runs',
      source: ['src/features/reminders/components/email-reminder-form.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-103',
      surface: 'SL-45',
      fn: ['F-090'],
      state:
        'alert "The reminder was not set. The conversation has been restored."',
      trigger: 'the server answers a set with a state other than pending',
      source: ['src/features/reminders/views/email-reminder-composer.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-627',
      surface: 'SL-45',
      fn: ['F-090'],
      state:
        'alert "Couldn’t confirm the change. Your time is still here; retrying this request is safe."',
      trigger: 'the reminder request throws',
      source: ['src/features/reminders/views/email-reminder-composer.tsx'],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-628',
      surface: 'SL-45',
      fn: ['F-090'],
      state:
        'alert "Couldn’t load this email reminder." with Retry; options disabled',
      trigger: 'the reminder query fails',
      source: [
        'src/features/reminders/views/email-reminder-composer.tsx',
        'src/features/reminders/components/email-reminder-form.tsx',
      ],
      flag: 'enable-reminders',
    },
    {
      id: 'STL-942',
      surface: 'SL-33',
      fn: ['F-160'],
      state: 'result: the dialog reads Access requested',
      trigger: 'after the action succeeds',
      source: [
        'src/lib/core/component/TopBar/ShareButton.tsx',
        'src/features/access-requests/views/RequestAccessView.tsx',
      ],
    },
    {
      id: 'STL-943',
      surface: 'SL-33',
      fn: ['F-160'],
      state:
        'the Share dialog opens by itself with "Permission requests (n)": who asked and for what access',
      trigger: 'the owner opens a thread with a request waiting',
      source: [
        'src/features/access-requests/share-request-trigger.tsx',
        'src/features/access-requests/views/PermissionRequestsView.tsx',
      ],
    },
    {
      id: 'STL-944',
      surface: 'SL-33',
      fn: ['F-160'],
      state:
        'result: the request leaves the dialog and the person joins the roster at the granted access',
      trigger: 'after Grant access succeeds',
      source: [
        'src/features/access-requests/views/PermissionRequestsView.tsx',
        'src/features/access-requests/views/DirectAccessView.tsx',
      ],
    },
    {
      id: 'STL-945',
      surface: 'SL-30',
      fn: ['F-167'],
      state:
        'result: the task composer or the assistant opens with the thread attached',
      trigger: 'after the action succeeds',
      source: [
        'src/features/block-email/views/email-thread-parts.tsx',
        'src/features/chat/ChatWithAgentButton.tsx',
      ],
    },
    {
      id: 'STL-948',
      surface: 'SL-25',
      fn: ['F-187'],
      state: 'result: the thread ID is on the clipboard',
      trigger: 'after the action succeeds',
      source: [
        'src/features/soup/createSoupEntityActions.ts',
        'src/features/next-soup/actions/make-copy-entity-id-action.ts',
      ],
    },
    {
      id: 'STL-980',
      surface: 'SL-32',
      fn: ['F-188'],
      state:
        'result: the panel shows the Tags, Properties and Activity sections and when the thread was created and last updated',
      trigger: 'open the panel on a thread',
      source: [
        'src/features/block-email/component/sidepanel/EmailSidePanelSections.tsx',
        'src/components/app/side-panel/EntityMetadata.tsx',
      ],
    },
    {
      id: 'STL-981',
      surface: 'SL-31',
      fn: ['F-064'],
      state:
        'result: the browser saves "<subject>.eml" with the source of the latest message',
      trigger: 'after the action succeeds',
      source: ['src/features/email-message/eml-download-adapter.ts'],
    },
  ],
} as const satisfies Group;
