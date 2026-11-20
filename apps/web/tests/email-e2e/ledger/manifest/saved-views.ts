// Saved views.

import { BOTH_VIEWPORTS, type Group } from './types';

export const savedViews = {
  name: 'saved-views',
  surfaces: [
    {
      id: 'SL-16',
      name: 'Saved view (open)',
      opened:
        'Sidebar Saved views row (on touch in the sidebar sheet); URL mail.savedView=<id>',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-46',
      name: 'Saved views sidebar section',
      opened:
        'Sidebar below Library; on touch the sidebar sheet (AL-911), below the tabs',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-48',
      name: 'Saved view builder dialog (create/edit/duplicate)',
      opened: 'Saved views +, Save view, menu Edit/Duplicate',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-49',
      name: 'Saved view ⋯ menu (header and row)',
      opened: '⋯ beside view name / on row; right-click a row',
      viewports: BOTH_VIEWPORTS,
    },
    {
      id: 'SL-50',
      name: 'Saved view unavailable / skipped-settings warning',
      opened: 'Open a view that is gone or has unknown settings',
      viewports: BOTH_VIEWPORTS,
    },
  ],
  actions: [
    // SL-46 sidebar section
    {
      id: 'AL-105',
      surface: 'SL-46',
      fn: ['F-046'],
      action: 'open saved view',
      trigger:
        'click sidebar saved-view row; on touch tap it in the sheet, which closes',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-list.tsx',
      ],
      note: "on touch it replaced the removed phone picker's rows (AL-702)",
    },
    {
      id: 'AL-106',
      surface: 'SL-46',
      fn: ['F-045'],
      action: 'create saved view (empty builder)',
      trigger:
        'sidebar Saved views "New saved view" + / empty-state "Create view"; on touch the same in the sheet',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-list.tsx',
      ],
      note: "on touch it replaced the removed phone picker's Create view (AL-703)",
    },
    {
      id: 'AL-114',
      surface: 'SL-46',
      fn: ['F-049'],
      action: 'reorder saved views',
      trigger: 'drag a row past another (4px threshold, two or more views)',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
      viewports: ['desktop'],
      note: 'touch reorders with Move up / Move down instead (AL-115)',
    },
    {
      id: 'AL-120',
      surface: 'SL-46',
      fn: ['F-046'],
      action: 'retry loading saved views',
      trigger: '"Retry loading views" button',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'AL-700',
      surface: 'SL-46',
      fn: ['F-046'],
      action: 'load more saved views',
      trigger: '"Load more views" button',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'AL-701',
      surface: 'SL-46',
      fn: ['F-046'],
      action: 'collapse / expand the Saved views section',
      trigger: 'section header "Saved views"',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-list.tsx',
      ],
    },
    {
      id: 'AL-115',
      surface: 'SL-46',
      fn: ['F-049'],
      action: 'move saved view up/down',
      trigger: 'touch: the sheet\'s row ⋯ menu "Move up" / "Move down"',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-menu.tsx',
      ],
      viewports: ['phone'],
      note: 'the reorder test also exercises the sheet at tablet width',
    },

    // SL-48 builder dialog
    {
      id: 'AL-109',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      action:
        'fill builder: Name, People chips (person or domain), Match from (From/To/Cc/Bcc), Subject contains',
      trigger: 'dialog fields',
      source: [
        'src/features/saved-views/components/saved-view-dialog.tsx',
        'src/features/email-view/components/EmailSavedViewFields.tsx',
      ],
    },
    {
      id: 'AL-704',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      action: 'add / remove Tags in the builder',
      trigger: 'Tags chip picker "Add tags" (shown when tags exist)',
      source: ['src/features/email-view/components/EmailSavedViewFields.tsx'],
    },
    {
      id: 'AL-705',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      action:
        'set advanced conditions: Importance, Read status, Done, Latest activity, Inboxes, Has (Starred, Calendar invite, PDFs, Images, Documents)',
      trigger: '"Advanced settings" toggle, then its fields',
      source: [
        'src/features/email-view/components/EmailSavedViewFields.tsx',
        'src/features/email-view/components/EmailFilterFields.tsx',
      ],
    },
    {
      id: 'AL-110',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      action: 'submit builder (create / save / duplicate)',
      trigger: 'dialog "Save view" / "Save changes" / "Duplicate"',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/views/saved-view-dialogs.tsx',
      ],
    },
    {
      id: 'AL-706',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      action: 'close builder without saving',
      trigger: 'dialog "Cancel"',
      source: ['src/features/saved-views/components/saved-view-dialog.tsx'],
    },

    // SL-49 view menu
    {
      id: 'AL-707',
      surface: 'SL-49',
      fn: ['F-047', 'F-048'],
      action: 'open the view menu',
      trigger:
        'header ⋯ "Saved view actions" / row ⋯ "Actions for <name>" / right-click a row',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-list.tsx',
      ],
    },
    {
      id: 'AL-111',
      surface: 'SL-49',
      fn: ['F-047'],
      action: 'edit saved view (builder with its conditions)',
      trigger: '⋯ menu "Edit"',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-menu.tsx',
      ],
    },
    {
      id: 'AL-112',
      surface: 'SL-49',
      fn: ['F-047'],
      action: 'duplicate saved view (builder named "<name> (copy)")',
      trigger: '⋯ menu "Duplicate"',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-menu.tsx',
      ],
    },
    {
      id: 'AL-113',
      surface: 'SL-49',
      fn: ['F-048'],
      action: 'delete saved view',
      trigger: '⋯ menu "Delete view", then confirm "Delete view"',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/views/saved-view-dialogs.tsx',
      ],
    },

    // SL-16 open view
    {
      id: 'AL-116',
      surface: 'SL-16',
      fn: ['F-047'],
      action: 'Save changes to open view',
      trigger:
        '"Save changes" (header; filter drawer footer on touch) while the view has edits',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/email-view/components/EmailHeader.tsx',
        'src/features/email-view/components/EmailFilterDrawer.tsx',
      ],
    },
    {
      id: 'AL-117',
      surface: 'SL-16',
      fn: ['F-047'],
      action: "Reset open view's edits",
      trigger: '"Reset" beside Save changes',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'AL-118',
      surface: 'SL-16',
      fn: ['F-047'],
      action: 'reload the view after a save conflict',
      trigger: '"Reload saved view" in the save-error group',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'AL-708',
      surface: 'SL-16',
      fn: ['F-047'],
      action: 'duplicate the edited view after a failed save',
      trigger: '"Duplicate" in the save-error group',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },

    // SL-50 unavailable
    {
      id: 'AL-119',
      surface: 'SL-50',
      fn: ['F-046'],
      action: 'Return to Email from unavailable view',
      trigger: '"Return to Email" button',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
  ],
  states: [
    // SL-46 sidebar section
    {
      id: 'STL-055',
      surface: 'SL-46',
      fn: ['F-046'],
      state: 'status "Loading views…"',
      trigger: 'views query pending with nothing loaded',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-056',
      surface: 'SL-46',
      fn: ['F-046'],
      state:
        'empty state "Your go-to views", "Save a set of senders, subjects, or filters to triage first." + "Create view"',
      trigger: 'no saved views',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-057',
      surface: 'SL-46',
      fn: ['F-046'],
      state: '"Retry loading views" button (no error text)',
      trigger: 'SavedViews query fails',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-058',
      surface: 'SL-46',
      fn: ['F-046'],
      state: 'unread dot on saved-view row (row label "<name>, unread mail")',
      trigger: 'view has unread mail in its first page',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/email-view/queries/use-email-saved-view-unread.ts',
      ],
    },
    {
      id: 'STL-701',
      surface: 'SL-46',
      fn: ['F-046'],
      state: 'the open view’s row is selected',
      trigger: 'open a saved view',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-702',
      surface: 'SL-46',
      fn: ['F-049'],
      state: 'rows show the new order at once',
      trigger: 'drop a dragged row (or Move up / Move down)',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-059',
      surface: 'SL-46',
      fn: ['F-049'],
      state:
        'toast with the server message or "Could not reorder views"; the order goes back',
      trigger: 'ReorderSavedViews fails',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
      toasts: [
        'src/features/email-view/views/email-saved-views.tsx#emailViews.reorderFailed',
      ],
    },
    {
      id: 'STL-703',
      surface: 'SL-46',
      fn: ['F-046'],
      state: '"Load more views" button, disabled while loading more',
      trigger: 'more saved views than one page',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },

    // SL-48 builder dialog
    {
      id: 'STL-705',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      state:
        'title "Save view" (name "New view") / "Edit “<name>”" / "Duplicate saved view" (name "<name> (copy)"); agent hint when creating',
      trigger: 'open the builder to create, edit or duplicate',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/views/saved-view-dialogs.tsx',
        'src/features/email-view/components/EmailSavedViewFields.tsx',
      ],
    },
    {
      id: 'STL-706',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      state:
        'submit disabled with an empty name or a definition that does not decode; "Saving…" while pending',
      trigger: 'clear the name / submit',
      source: [
        'src/features/saved-views/components/saved-view-dialog.tsx',
        'src/features/email-view/views/email-saved-views.tsx',
      ],
    },
    {
      id: 'STL-707',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      state: 'alert with the save error inside the dialog',
      trigger: 'CreateSavedView / UpdateSavedView fails',
      source: [
        'src/features/saved-views/views/saved-view-dialogs.tsx',
        'src/features/saved-views/components/saved-view-dialog.tsx',
      ],
    },
    {
      id: 'STL-708',
      surface: 'SL-48',
      fn: ['F-045', 'F-047'],
      state:
        'Advanced settings start open when the view sets one; Inboxes shown with two or more inboxes; Tags shown when tags exist',
      trigger: 'open the builder',
      source: ['src/features/email-view/components/EmailSavedViewFields.tsx'],
    },
    {
      id: 'STL-060',
      surface: 'SL-48',
      fn: ['F-045'],
      state:
        'toast with the reason the current filters cannot be saved; no dialog',
      trigger: 'Save view when the list’s filters cannot be captured',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
      toasts: [
        'src/features/email-view/views/email-saved-views.tsx#captured.error',
      ],
    },

    // SL-49 view menu
    {
      id: 'STL-066',
      surface: 'SL-49',
      fn: ['F-048'],
      state:
        'confirmation "Delete “<name>”?" with "This removes the view. Your email isn’t deleted."',
      trigger: 'Delete view in menu',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-dialog.tsx',
      ],
    },
    {
      id: 'STL-709',
      surface: 'SL-49',
      fn: ['F-048'],
      state: 'alert with the delete error inside the confirmation',
      trigger: 'DeleteSavedView fails',
      source: [
        'src/features/saved-views/views/saved-view-dialogs.tsx',
        'src/features/saved-views/components/saved-view-dialog.tsx',
      ],
    },
    {
      id: 'STL-710',
      surface: 'SL-49',
      fn: ['F-048'],
      state: 'the list returns to the tab it was opened from',
      trigger: 'delete the view that is open',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-711',
      surface: 'SL-49',
      fn: ['F-049'],
      state:
        "desktop row menus have no Move items; on touch the sheet's row menus have Move up / Move down (absent at either end)",
      trigger: 'open a row menu',
      source: [
        'src/features/email-view/views/email-saved-views.tsx',
        'src/features/saved-views/components/saved-view-menu.tsx',
      ],
    },

    // SL-16 open view
    {
      id: 'STL-065',
      surface: 'SL-16',
      fn: ['F-046'],
      state:
        'list placeholder while the view loads, then its mail; unavailable state instead when it cannot be opened',
      trigger: 'open saved view',
      source: ['src/features/email-view/email-view.tsx'],
    },
    {
      id: 'STL-704',
      surface: 'SL-16',
      fn: ['F-046'],
      state:
        'the touch list header names the open view, as the desktop header does',
      trigger: 'open / leave a saved view on touch',
      source: [
        'src/features/email-view/email-view.tsx',
        'src/features/email-view/views/email-saved-views.tsx',
      ],
      viewports: ['phone'],
    },
    {
      id: 'STL-712',
      surface: 'SL-16',
      fn: ['F-046'],
      state: 'header shows the view’s name with its ⋯ menu; no tab selected',
      trigger: 'open saved view',
      source: [
        'src/features/email-view/components/EmailHeader.tsx',
        'src/features/email-view/views/email-saved-views.tsx',
      ],
    },
    {
      id: 'STL-061',
      surface: 'SL-16',
      fn: ['F-047'],
      state: '"Save changes" and "Reset" shown while the view has edits',
      trigger: 'edit filters in open view',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-713',
      surface: 'SL-16',
      fn: ['F-047'],
      state:
        '"Save changes" disabled while saving or when the view has skipped settings',
      trigger: 'click Save changes / edit a view with skipped settings',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-062',
      surface: 'SL-16',
      fn: ['F-047'],
      state:
        'save-error alert with "Duplicate"; "Reload saved view" too on a conflict',
      trigger: 'UpdateSavedView conflict or failure',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-700',
      surface: 'SL-16',
      fn: ['F-047'],
      state: 'toast with the reason the edits cannot be saved',
      trigger: 'Save changes when the view’s filters cannot be captured',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
      toasts: [
        'src/features/email-view/views/email-saved-views.tsx#config.error',
      ],
    },

    // SL-50 unavailable / warning
    {
      id: 'STL-063',
      surface: 'SL-50',
      fn: ['F-046'],
      state:
        'alert "This saved view is unavailable or you no longer have access." + "Return to Email"',
      trigger: 'open deleted or inaccessible view',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
    {
      id: 'STL-064',
      surface: 'SL-50',
      fn: ['F-046'],
      state:
        'alert "Some saved settings were skipped." with "Skipped settings: <names>"',
      trigger: 'view has settings this client cannot apply',
      source: ['src/features/email-view/views/email-saved-views.tsx'],
    },
  ],
} as const satisfies Group;
