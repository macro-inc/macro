import { getFaviconUrl } from '@app/util/favicon';
import { markdownToPlainText } from '@lexical-core';
import { themeReactive } from '../block-theme/signals/themeReactive';
import {
  extractNotificationData,
  type NotificationData,
} from './notification-preview';
import {
  DefaultDocumentNameResolver,
  DefaultUserNameResolver,
  type DocumentNameResolver,
  type UserNameResolver,
} from './notification-resolvers';
import type { PlatformNotificationInterface, PlatformNotificationState } from './components/PlatformNotificationProvider';
import { notificationWithMetadata } from './notification-metadata';
import type { UnifiedNotification } from '@service-notification/client';
import type { SplitManager } from '@app/component/split-layout/layoutManager';
import { openNotification } from './notification-navigation';

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
  data: NotificationData,
  resolveUserName: UserNameResolver,
  resolveDocumentName: DocumentNameResolver
): Promise<PlatformNotificationData | null> {
  if (!data) return null;

  const actor =
    (data.actor ? await resolveUserName(data.actor.id) : undefined) ??
    USER_NAME_FALLBACK;

  const showTarget = data.target?.show ?? false;

  const targetName =
    data.target?.name ??
    (data.target?.id
      ? await resolveDocumentName(data.target.id, data.target.type)
      : undefined) ??
    DOCUMENT_NAME_FALLBACK;

  const accentColor = getAccentColorForIcon();
  const icon = getFaviconUrl(accentColor);

  return {
    title: `${actor}${showTarget ? ` <${targetName}>` : ''}`,
    options: {
      body: data.content ? markdownToPlainText(data.content) : `${data.action}`,
      icon,
    },
  };
}

/**
 * Maybe handles a new notification as a platform notification.
 * If the notification is supported and formattable emit it and handle click events.
 * @param notification
 * @param notificationInterface
 * @param splitLayoutManager
 */
export async function maybeHandlePlatformNotification(
  notification: UnifiedNotification,
  notificationInterface: PlatformNotificationState,
  splitLayoutManager: SplitManager
) {
  const nm = notificationWithMetadata(notification);
  if (!nm) return;
  const data = extractNotificationData(nm);
  if (data === 'no_extractor' || data === 'no_extracted_data') return;

  const platformNotificationData = await toPlatformNotificationData(
    data,
    DefaultUserNameResolver,
    DefaultDocumentNameResolver
  );

  if (platformNotificationData) {
    let notificationHandle = await notificationInterface.showNotification(
      platformNotificationData
    );
    if (notificationHandle !== 'not-granted' && notificationHandle !== 'disabled-in-ui') {
      notificationHandle.onClick(() => {
        openNotification(nm, splitLayoutManager);
      });
    }
  }
}
