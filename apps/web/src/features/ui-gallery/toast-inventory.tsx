import { t } from '@app/lib/i18n';
import { type ToastContent, ToastType } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import Bell from '@icon/system/regular/bell.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import SplitIcon from '@icon/system/regular/square-half.svg';
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
        title: 'Enable Browser Notifications',
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
        title: 'Enable Desktop Notifications',
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
        title: 'Enable Notifications',
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
        title: 'Show Calls on Your Lock Screen',
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
        actions: [{ label: 'Reconnect', onClick: dismiss }],
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
        title: 'Reconnect email and calendar',
        content: () =>
          'Sync stopped for user@example.com. Reconnect to restore email and calendar sync.',
        actions: [{ label: 'Reconnect', onClick: dismiss }],
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
        actions: [{ label: 'Reconnect', onClick: dismiss }],
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
        actions: [{ label: 'Try again', onClick: dismiss }],
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
        title: 'A new version of Macro is ready',
        actions: [{ label: 'Reload', onClick: dismiss }],
      },
    }),
  },
  // compose-adapter.ts supplies this custom error icon and the recovery-action icon.
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
            icon: ArrowCounterClockwise,
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
    desktopOnly: true,
    name: 'Move to folder',
    category: 'Navigation',
    source: 'features/entity/bulk-edit/moved-to-folder-toast.ts',
    trigger: 'An item is moved to another folder.',
    behavior: '4.5 seconds · desktop example has room for another split',
    create: (dismiss) => ({
      toastType: ToastType.SUCCESS,
      message: t('entityActions.toastMovedToFolder'),
      actions: [
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          onClick: dismiss,
        },
        ...(!isTouchDevice()
          ? [
              {
                label: t('entityActions.openInNewSplit'),
                icon: SplitIcon,
                onClick: dismiss,
              },
            ]
          : []),
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
      actions: [
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          onClick: dismiss,
        },
      ],
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
        actions: [{ label: 'Cancel', onClick: dismiss }],
      },
    }),
  },
];
