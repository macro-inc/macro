import { t } from '@app/lib/i18n';
import { type ToastContent, ToastType } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import Bell from '@icon/system/regular/bell.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import SplitIcon from '@icon/system/regular/square-half.svg';
import XIcon from '@icon/system/regular/x.svg';
import PhoneIncoming from '@phosphor/phone-incoming.svg';
import type { ComponentProps } from 'solid-js';

type PreviewToast = Omit<ComponentProps<typeof ToastContent>, 'toastId'>;

export type ToastInventoryEntry = {
  name: string;
  category: string;
  source: string;
  trigger: string;
  /** This specimen includes a desktop-only action set. */
  desktopOnly?: boolean;
  behavior: string;
  create: (dismiss: () => void) => PreviewToast;
};

/** Presentation fixtures only: never import production hosts or action handlers. */
export const TOAST_INVENTORY: ToastInventoryEntry[] = [
  {
    name: 'Calendar access',
    category: 'Setup prompts',
    source: 'features/auth/CalendarPermissionPrompt.tsx',
    trigger: 'A connected inbox has not granted calendar access.',
    behavior: 'Persistent · closing is remembered across reloads',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: 'Enable calendar',
        content: () =>
          'Macro can now sync your calendar. Grant calendar access for user@example.com to turn it on.',
        actions: [{ label: 'Grant access', onClick: dismiss }],
      },
    }),
  },
  {
    name: 'Local runtime setup',
    category: 'Setup prompts',
    source: 'features/local-runtime/local-runtime-host.tsx',
    trigger: 'The desktop agent runtime has not been set up.',
    behavior: 'Persistent · desktop only · closing is remembered',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: t('localRuntime.promptTitle'),
        content: () => t('localRuntime.promptBody'),
        actions: [{ label: t('localRuntime.setUp'), onClick: dismiss }],
      },
    }),
  },
  {
    name: 'WhatsApp history import',
    category: 'Setup prompts',
    source: 'features/whatsapp-linked/components/history-import-prompt.tsx',
    trigger: 'Earlier messages are waiting for the connected phone.',
    behavior: 'Persistent · desktop only · closing is remembered',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: 'Import WhatsApp history',
        content: () =>
          'Open WhatsApp on your phone and keep it open, then import earlier messages of 3 chats.',
        actions: [{ label: 'Import', onClick: dismiss }],
      },
    }),
  },
  {
    name: 'Browser notification permission',
    category: 'Setup prompts',
    source: 'features/notifications/components/BrowserNotificationModal.tsx',
    trigger: 'Notifications are available but have not been enabled.',
    behavior: 'Persistent · closing is remembered',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: 'Enable notifications',
        icon: Bell,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Get notified about new messages, mentions, comments, and emails.
          </div>
        ),
        actions: [{ label: 'Enable', onClick: dismiss }],
      },
    }),
  },
  {
    name: 'Desktop notification permission',
    category: 'Setup prompts',
    source: 'features/notifications/components/BrowserNotificationModal.tsx',
    trigger: 'The desktop app has not enabled notifications.',
    behavior: 'Persistent · desktop app · closing is remembered',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: 'Enable notifications',
        icon: Bell,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Get notified about new messages, mentions, comments, and emails.
          </div>
        ),
        actions: [{ label: 'Enable', onClick: dismiss }],
      },
    }),
  },
  {
    name: 'Android notification permission',
    category: 'Setup prompts',
    source: 'features/notifications/components/BrowserNotificationModal.tsx',
    trigger: 'The Android app has not enabled notifications.',
    behavior: 'Persistent · Android only · closing is remembered',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: 'Enable notifications',
        icon: Bell,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Get notified about new messages, mentions, comments, and emails.
          </div>
        ),
        actions: [{ label: 'Enable', onClick: dismiss }],
      },
    }),
  },
  {
    name: 'Lock-screen calls',
    category: 'Setup prompts',
    source: 'features/channel/Call/FullScreenCallPrompt.tsx',
    trigger: 'Android needs permission to show incoming calls while locked.',
    behavior: 'Persistent · Android only · closing is remembered',
    create: (dismiss) => ({
      custom: {
        dismissLabel: t('common.notNow'),
        title: 'Lock-screen calls',
        icon: PhoneIncoming,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Allow full-screen notifications so incoming calls open even when
            your phone is locked.
          </div>
        ),
        actions: [{ label: 'Allow', onClick: dismiss }],
      },
    }),
  },
  {
    name: 'Reconnect inbox',
    category: 'Recovery',
    source: 'features/auth/GmailReauthenticationPrompt.tsx',
    trigger: 'The inbox authorization has expired and email sync stopped.',
    behavior: 'Persistent · closing suppresses the prompt for this session',
    create: (dismiss) => ({
      custom: {
        title: 'Reconnect inbox',
        content: () =>
          'Sync stopped for user@example.com. Reconnect to restore email sync.',
        actions: [
          { label: 'Reconnect', icon: ArrowCounterClockwise, onClick: dismiss },
        ],
      },
    }),
  },
  {
    name: 'Reconnect email and calendar',
    category: 'Recovery',
    source: 'features/auth/GmailReauthenticationPrompt.tsx',
    trigger: 'The combined email and calendar authorization has expired.',
    behavior: 'Persistent · closing suppresses the prompt for this session',
    create: (dismiss) => ({
      custom: {
        title: 'Reconnect inbox',
        content: () =>
          'Sync stopped for user@example.com. Reconnect to restore email and calendar sync.',
        actions: [
          { label: 'Reconnect', icon: ArrowCounterClockwise, onClick: dismiss },
        ],
      },
    }),
  },
  {
    name: 'Reconnect GitHub',
    category: 'Recovery',
    source: 'features/auth/GithubReauthenticationPrompt.tsx',
    trigger: 'The GitHub authorization has expired.',
    behavior: 'Persistent · closing suppresses the prompt for this session',
    create: (dismiss) => ({
      custom: {
        title: 'Reconnect GitHub',
        content: () =>
          'Your GitHub authorization has expired. Reconnect GitHub to restore pull request details.',
        actions: [
          { label: 'Reconnect', icon: ArrowCounterClockwise, onClick: dismiss },
        ],
      },
    }),
  },
  {
    name: 'Email permissions declined',
    category: 'Recovery',
    source: 'features/auth/EmailAuth.tsx',
    trigger:
      'Account connection was stopped because email access was declined.',
    behavior: 'Persistent',
    create: (dismiss) => ({
      custom: {
        title: 'Email access required',
        content: () =>
          "Macro connects an account's email and calendar together, so keep the email permissions checked. The account was not connected.",
        actions: [
          { label: 'Try again', icon: ArrowCounterClockwise, onClick: dismiss },
        ],
      },
    }),
  },
  {
    name: 'New app version',
    category: 'Recovery',
    source: 'lib/core/util/reloadForNewerBuild.ts',
    trigger: 'A touch device needs a reload to apply a newer web build.',
    behavior: 'Persistent · touch devices only',
    create: (dismiss) => ({
      custom: {
        title: 'Update ready',
        actions: [
          { label: 'Reload', icon: ArrowCounterClockwise, onClick: dismiss },
        ],
      },
    }),
  },
  // compose-adapter.ts supplies the custom error icon.
  {
    name: 'Draft-save recovery',
    category: 'Recovery',
    source: 'features/email-compose/primitives/draft-identity.ts',
    trigger:
      'A queued draft save was rejected while edits remain in the editor.',
    behavior: 'Persistent · fallback when inline recovery is unavailable',
    create: (dismiss) => ({
      custom: {
        title: 'Draft could not be saved',
        icon: ExclamationIcon,
        color: 'var(--color-failure)',
        content: () =>
          'Your edits are still in this editor. Save them as a new draft before closing.',
        actions: [
          {
            label: 'Save as new draft',
            onClick: dismiss,
          },
        ],
      },
    }),
  },
  {
    name: 'Sending email',
    category: 'Undo',
    source: 'features/email-compose/primitives/queued-send-notice.ts',
    trigger: 'An email send is queued and can still be undone.',
    behavior: '4.5 seconds initially · then the server undo deadline',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Sending…',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
      ],
    }),
  },
  {
    name: 'Email queued offline',
    category: 'Undo',
    source: 'features/email-compose/primitives/queued-send-notice.ts',
    trigger: 'An email is queued while the device is offline.',
    behavior: '4.5 seconds initially · then the server undo deadline',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Email queued to send',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
      ],
    }),
  },
  {
    name: 'Mark done',
    category: 'Undo',
    source: 'features/next-soup/actions/make-mark-done-action.ts',
    trigger: 'A list item is marked as done.',
    behavior: '3 seconds · hidden on mobile',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: t('entityActions.toastMarkedDone'),
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        {
          label: t('entityActions.undo'),
          icon: ArrowCounterClockwise,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Database row deleted',
    category: 'Undo',
    source: 'features/block-database/component/Block.tsx',
    trigger: 'A destructive database change deletes a row, column, or option.',
    behavior: '4.5 seconds · also used by embedded document databases',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Row deleted',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
      ],
    }),
  },
  {
    name: 'Email moved to Trash',
    category: 'Undo',
    source: 'features/block-email/component/useEmailThreadTools.tsx',
    trigger: 'The open email conversation is moved to Trash.',
    behavior: '10 seconds',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Moved to Trash',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
      ],
    }),
  },
  {
    name: 'Sender blocked',
    category: 'Undo',
    source: 'lib/queries/email/thread.ts',
    trigger: 'A sender block is queued.',
    behavior: '4.5 seconds',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Sender block queued',
      subtext: 'Applying the rule for user@example.com',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
      ],
    }),
  },
  {
    name: 'Sender moved to Signal',
    category: 'Undo',
    source: 'lib/queries/email/thread.ts',
    trigger: 'A sender is classified as Signal or Noise.',
    behavior: '4.5 seconds',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Sender marked as Signal',
      subtext: 'Messages from user@example.com will appear in Signal',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
      ],
    }),
  },
  {
    name: 'Scheduled email',
    category: 'Undo / Navigation',
    source: 'features/email-compose/primitives/email-send-schedule.ts',
    trigger: 'An email is scheduled with a link back to the message.',
    behavior: '8 seconds · Undo is available after the initial schedule',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Email scheduled',
      subtext: 'Sends Mon, Nov 9 at 9:00 AM',
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        { label: 'Undo', icon: ArrowCounterClockwise, onClick: dismiss },
        {
          label: 'View message',
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Rescheduled email',
    category: 'Navigation',
    source: 'features/email-compose/primitives/email-send-schedule.ts',
    trigger: 'The scheduled send time is changed.',
    behavior: '8 seconds · no Undo action on reschedule',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Email rescheduled',
      subtext: 'Sends Mon, Nov 9 at 10:00 AM',
      dismissStyle: 'icon',
      actions: [
        {
          label: 'View message',
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Task created',
    category: 'Navigation',
    source: 'features/task-composer/primitives/taskCreatedToast.ts',
    trigger: 'A task is created without navigating away from the current view.',
    behavior: '4.5 seconds · Open split is omitted on touch devices',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Task created',
      dismissStyle: 'icon',
      actions: [
        ...(!isTouchDevice()
          ? [
              {
                label: t('entityActions.toastOpenSplit'),
                icon: SplitIcon,
                trailingIcon: true,
                variant: 'secondary' as const,
                onClick: dismiss,
              },
            ]
          : []),
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Project created',
    category: 'Navigation',
    source: 'features/projects/project-view.tsx',
    trigger: 'A task project finishes being created after its composer closes.',
    behavior: '4.5 seconds',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Project created',
      dismissStyle: 'icon',
      actions: [
        {
          label: t('entityActions.toastOpenSplit'),
          icon: SplitIcon,
          trailingIcon: true,
          variant: 'secondary',
          onClick: dismiss,
        },
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Skill created',
    category: 'Navigation',
    source: 'features/block-md/component/ComposeSkill.tsx',
    trigger: 'A skill is created and its link is copied successfully.',
    behavior: '4.5 seconds · Link copied is omitted if clipboard access fails',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Skill created',
      subtext: 'Link copied',
      dismissStyle: 'icon',
      actions: [
        {
          label: t('entityActions.toastOpenSplit'),
          icon: SplitIcon,
          trailingIcon: true,
          variant: 'secondary',
          onClick: dismiss,
        },
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Folder created',
    category: 'Navigation',
    source: 'features/drive-view/folder-compose-view.tsx',
    trigger: 'A Drive folder finishes being created after its composer closes.',
    behavior: '4.5 seconds',
    create: (dismiss) => ({
      dismissStyle: 'icon',
      custom: {
        title: 'Example folder created',
        icon: FolderIcon,
        actions: [
          {
            label: t('entityActions.open'),
            icon: ArrowSquareOutIcon,
            trailingIcon: true,
            onClick: dismiss,
          },
        ],
      },
    }),
  },
  {
    name: 'Folder uploaded',
    category: 'Navigation',
    source: 'lib/utils/handleFileUpload.ts',
    trigger: 'A background folder upload finishes.',
    behavior: '4.5 seconds',
    create: (dismiss) => ({
      dismissStyle: 'icon',
      custom: {
        title: 'Example folder uploaded',
        icon: FolderIcon,
        actions: [
          {
            label: t('entityActions.open'),
            icon: ArrowSquareOutIcon,
            trailingIcon: true,
            onClick: dismiss,
          },
        ],
      },
    }),
  },
  {
    name: 'Forwarded message',
    category: 'Navigation',
    source: 'lib/core/component/ForwardToChannel.tsx',
    trigger: 'A message is successfully forwarded to one channel.',
    behavior: '4.5 seconds · multi-channel sends have no navigation action',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Message sent',
      dismissStyle: 'icon',
      actions: [
        {
          label: 'View in channel',
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Calendar event created',
    category: 'Navigation',
    source: 'lib/core/component/AI/component/tool/calendar/ChatCompose.tsx',
    trigger: 'An AI-created calendar event is confirmed.',
    behavior: '4.5 seconds',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: 'Event created',
      dismissStyle: 'icon',
      actions: [
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    desktopOnly: true,
    name: 'Move to folder',
    category: 'Navigation',
    source: 'features/entity/bulk-edit/moved-to-folder-toast.ts',
    trigger: 'An item is moved to another folder.',
    behavior: '4.5 seconds · desktop example has room for another split',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: t('entityActions.toastMovedToFolder'),
      dismissStyle: 'icon',
      actions: [
        ...(!isTouchDevice()
          ? [
              {
                label: t('entityActions.toastOpenSplit'),
                icon: SplitIcon,
                trailingIcon: true,
                variant: 'secondary' as const,
                onClick: dismiss,
              },
            ]
          : []),
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Move to folder without split capacity',
    category: 'Navigation',
    source: 'features/entity/bulk-edit/moved-to-folder-toast.ts',
    trigger: 'An item is moved while no additional split can be opened.',
    behavior: '4.5 seconds · also represents the touch action set',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: t('entityActions.toastMovedToFolder'),
      dismissStyle: 'icon',
      actions: [
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: dismiss,
        },
      ],
    }),
  },
  {
    name: 'Routine started',
    category: 'Routine feedback',
    source: 'features/agent-cards/components/routine-card.tsx',
    trigger: 'A routine is started manually.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.SUCCESS,
      message: 'Routine started',
    }),
  },
  {
    name: 'Routine update failed',
    category: 'Routine feedback',
    source: 'features/agent-cards/components/routine-card.tsx',
    trigger: 'Enabling or disabling a routine fails.',
    behavior: '4.5 seconds · supporting error detail is illustrative',
    create: () => ({
      toastType: ToastType.ALERT,
      message: 'Could not update routine',
      subtext: 'Failed to fetch',
    }),
  },
  {
    name: 'Routine run failed',
    category: 'Routine feedback',
    source: 'features/agent-cards/components/routine-card.tsx',
    trigger: 'Starting a routine manually fails.',
    behavior: '4.5 seconds · supporting error detail is illustrative',
    create: () => ({
      toastType: ToastType.ALERT,
      message: 'Could not run routine',
      subtext: 'Failed to fetch',
    }),
  },
  {
    name: 'Email marked unread',
    category: 'Entity feedback',
    source: 'features/next-soup/actions/make-mark-unread-action.ts',
    trigger: 'Several email conversations are marked unread.',
    behavior: '3 seconds · hidden on mobile',
    create: () => ({
      toastType: ToastType.SUCCESS,
      message: t('entityActions.toastMarkedUnreadCount', { count: 3 }),
    }),
  },
  {
    name: 'Favorite waiting to sync',
    category: 'Entity feedback',
    source: 'features/next-soup/actions/make-favorite-action.ts',
    trigger: 'A favorite update is queued for synchronization.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.ALERT,
      message: t('entityActions.toastWaitingToSync', {
        message: t('entityActions.toastAddedToFavorites'),
      }),
    }),
  },
  {
    name: 'Favorites partly updated',
    category: 'Entity feedback',
    source: 'features/next-soup/actions/make-favorite-action.ts',
    trigger: 'Some selected items are favorited, but another update fails.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: t('entityActions.toastAddedSomeToFavorites', {
        succeeded: 2,
        count: 3,
        failed: 1,
      }),
    }),
  },
  {
    name: 'Favorites update failed',
    category: 'Entity feedback',
    source: 'features/next-soup/actions/make-favorite-action.ts',
    trigger: 'Every selected favorite update fails.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: t('entityActions.toastFavoritesUpdateFailed'),
    }),
  },
  {
    name: 'Cancelling email send',
    category: 'Send cancellation',
    source: 'features/email-compose/undo-send.ts',
    trigger: 'Undo waits for the server to confirm a queued-send cancellation.',
    behavior: 'Persistent until the cancellation request settles',
    create: () => ({
      toastType: ToastType.LOADING,
      message: 'Cancelling send…',
    }),
  },
  {
    name: 'Email send cancelled',
    category: 'Send cancellation',
    source: 'features/email-compose/undo-send.ts',
    trigger: 'The server confirms that an email send was cancelled.',
    behavior: '4.5 seconds',
    create: () => ({ toastType: ToastType.SUCCESS, message: 'Send cancelled' }),
  },
  {
    name: 'Email cancellation pending',
    category: 'Send cancellation',
    source: 'features/email-compose/undo-send.ts',
    trigger: 'The cancellation has not yet been confirmed by the server.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.ALERT,
      message: 'Cancellation pending',
      subtext: 'Waiting for confirmation',
    }),
  },
  {
    name: 'Email cancellation too late',
    category: 'Send cancellation',
    source: 'features/email-compose/undo-send.ts',
    trigger: 'Delivery starts before the queued-send cancellation succeeds.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: 'Too late to undo',
      subtext: 'Delivery has already started',
    }),
  },
  {
    name: 'Email cancellation failed',
    category: 'Send cancellation',
    source: 'features/email-compose/undo-send.ts',
    trigger: 'Undo send fails without a pending or too-late result.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: 'Failed to undo send',
    }),
  },
  {
    name: 'Tasks imported',
    category: 'Import results',
    source: 'features/integrations/import-linear/ImportLinear.tsx',
    trigger: 'A task import finishes with successfully created tasks.',
    behavior:
      '4.5 seconds · also shown for successful rows of a partial import',
    create: () => ({
      toastType: ToastType.SUCCESS,
      message: 'Imported 8 tasks',
    }),
  },
  {
    name: 'Tasks failed to import',
    category: 'Import results',
    source: 'features/integrations/import-linear/ImportLinear.tsx',
    trigger: 'Some imported task rows fail after the import finishes.',
    behavior: '4.5 seconds · separate from the successful-row toast',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: '2 tasks failed to import',
    }),
  },
  {
    name: 'File downloaded',
    category: 'File transfer',
    source: 'features/block-pdf/util/pdf-file-actions.ts',
    trigger: 'An exported DOCX document is saved successfully.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.SUCCESS,
      message: 'File downloaded successfully',
    }),
  },
  {
    name: 'File download failed',
    category: 'File transfer',
    source: 'features/block-pdf/util/pdf-file-actions.ts',
    trigger: 'Exporting or downloading a DOCX document fails.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: 'Failed to download file',
    }),
  },
  {
    name: 'Attachment download failed',
    category: 'File transfer',
    source: 'features/email-message/attachment-action-adapter.ts',
    trigger: 'The attachment download request fails.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: 'Download failed',
      subtext: 'Please try again',
    }),
  },
  {
    name: 'Attachment open failed',
    category: 'Operation failures',
    source: 'features/email-message/attachment-action-adapter.ts',
    trigger: 'The attachment document lookup or its metadata lookup fails.',
    behavior: '4.5 seconds',
    create: () => ({
      toastType: ToastType.FAILURE,
      message: 'Attachment unavailable',
      subtext: 'Please try again',
    }),
  },
  {
    name: 'Android file preparation',
    category: 'Progress',
    source: 'lib/core/mobile/exportAndroidFileWithProgress.ts',
    trigger:
      'A file over 1 MB is being transferred to the native file chooser.',
    behavior: 'Persistent until completion · Android only',
    create: (dismiss) => ({
      custom: {
        title: 'Preparing file… 45%',
        actions: [{ label: 'Cancel', icon: XIcon, onClick: dismiss }],
      },
    }),
  },
];
