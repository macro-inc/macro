import type {
  PlatformNotificationHandle,
  PlatformNotificationInterface,
} from '@notifications';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  generateDeepLinkUrl,
  isHighPriorityNotification,
} from './notification-helpers';

type HighPriorityNotificationPayload = Parameters<
  typeof isHighPriorityNotification
>[0];

export function createTauriNotificationInterface(
  setDisabled: () => Promise<void>
): PlatformNotificationInterface {
  async function getPermissionState() {
    return (await isPermissionGranted()) ? 'granted' : 'denied';
  }
  return {
    requestPermission: async () => {
      const cur = await getPermissionState();
      if (cur === 'granted') {
        return 'granted';
      }
      return await requestPermission();
    },
    getCurrentPermission: getPermissionState,
    showNotification: async (data) => {
      const granted = await getPermissionState();
      const notificationHandle = createTauriNotification();

      if (granted !== 'granted') {
        return 'not-granted';
      }

      if (!data.options) {
        await dispatchNotification({ title: data.title });
        return notificationHandle;
      }

      const fullNotification = data.options
        .data as HighPriorityNotificationPayload | undefined;

      if (!fullNotification) {
        const { body, icon, ...rest } = data.options;

        await dispatchNotification({
          title: data.title,
          body,
          icon,
          extra: {
            ...rest,
          },
        });
        return notificationHandle;
      }

      if (!isHighPriorityNotification(fullNotification)) {
        const payloadExtra = sanitizeNotificationPayload(fullNotification);

        await dispatchNotification({
          title: data.title,
          body: data.options.body,
          icon: data.options.icon,
          extra: payloadExtra ? { payload: payloadExtra } : undefined,
        });
        return notificationHandle;
      }

      const deepLinkUrl = generateDeepLinkUrl(fullNotification);

      await dispatchNotification({
        title: data.title,
        body: data.options.body,
        icon: data.options.icon,
        extra: deepLinkUrl ? { deepLinkUrl } : undefined,
      });

      return notificationHandle;
    },
    unregisterNotifications: setDisabled,
  };
}

function createTauriNotification(): PlatformNotificationHandle {
  return {
    onClick: (_cb) => {
      console.warn(
        'notification on click is not yet supported on this platform'
      );
    },
    close() {
      console.warn('notification close is not yet supported on this platform');
    },
  };
}

async function dispatchNotification({
  title,
  body,
  icon,
  extra,
}: {
  title: string;
  body?: string;
  icon?: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  return sendNotification({
    title,
    body,
    icon,
    extra,
  });
}

export function sanitizeNotificationPayload(
  payload: HighPriorityNotificationPayload
): Record<string, unknown> | undefined {
  try {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  } catch (error) {
    console.warn('failed to serialize notification payload', error);
    return undefined;
  }
}
