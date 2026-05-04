import type { SplitManager } from '@app/component/split-layout/layoutManager';
import { getFaviconUrl } from '@app/util/favicon';
import { markdownToPlainText } from '@lexical-core';
import type { UnifiedNotification } from './types';
import { themeReactive } from '../theme/signals/themeReactive';
import type { PlatformNotificationState } from './components/PlatformNotificationProvider';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  shouldShowNotificationTarget,
} from './notification-metadata';
import { openNotification } from './notification-navigation';
import {
  DefaultDocumentNameResolver,
  DefaultUserNameResolver,
  type DocumentNameResolver,
  type UserNameResolver,
} from './notification-resolvers';

/// the interface for a singular notification on this device
export interface PlatformNotificationHandle {
  onClick: (cb: () => void) => void;
  close: () => void;
}

export interface PlatformNotificationData {
  title: string;
  options?: NotificationOptions;
}

const USER_NAME_FALLBACK = 'Someone';
const DOCUMENT_NAME_FALLBACK = 'Something';

function getAccentColorForIcon(): string {
  const { l, c, h } = themeReactive.a0;
  return `oklch(${l[0]()} ${c[0]()} ${h[0]()}deg)`;
}

export async function toPlatformNotificationData(
  notification: UnifiedNotification,
  resolveUserName: UserNameResolver,
  resolveDocumentName: DocumentNameResolver
): Promise<PlatformNotificationData | null> {
  const actorId = notification.sender_id;
  const actor =
    (actorId ? await resolveUserName(actorId) : undefined) ??
    USER_NAME_FALLBACK;

  const showTarget = shouldShowNotificationTarget(notification);
  const targetName =
    getNotificationTargetName(notification) ??
    (await resolveDocumentName(
      notification.entity_id,
      notification.entity_type
    )) ??
    DOCUMENT_NAME_FALLBACK;

  const content = getNotificationContent(notification);
  const action = getNotificationAction(notification);

  const accentColor = getAccentColorForIcon();
  const icon = getFaviconUrl(accentColor);

  return {
    title: `${actor}${showTarget ? ` <${targetName}>` : ''}`,
    options: {
      body: content ? markdownToPlainText(content) : action,
      icon,
    },
  };
}

/**
 * Maybe handles a new notification as a platform notification.
 * If the notification is supported and formattable emit it and handle click events.
 */
export async function maybeHandlePlatformNotification(
  notification: UnifiedNotification,
  notificationInterface: PlatformNotificationState,
  splitLayoutManager: SplitManager
) {
  // Ignore notification types that should not show as browser notifications
  if (notification.notification_metadata.tag === 'document_mention') {
    return;
  }

  const platformNotificationData = await toPlatformNotificationData(
    notification,
    DefaultUserNameResolver,
    DefaultDocumentNameResolver
  );

  if (platformNotificationData) {
    let notificationHandle = await notificationInterface.showNotification(
      platformNotificationData
    );
    if (
      notificationHandle !== 'not-granted' &&
      notificationHandle !== 'disabled-in-ui'
    ) {
      notificationHandle.onClick(() => {
        window.focus();
        openNotification(notification, splitLayoutManager);
        notificationHandle.close();
      });
    }
  }
}
