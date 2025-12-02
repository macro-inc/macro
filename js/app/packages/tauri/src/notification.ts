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

export function createTauriNotificationInterface(
  setDisabled: () => Promise<void>
): PlatformNotificationInterface {
  async function getCur() {
    return (await isPermissionGranted()) ? 'granted' : 'denied';
  }
  return {
    requestPermission: async () => {
      const cur = await getCur();
      if (cur === 'granted') {
        return 'granted';
      }
      return await requestPermission();
    },
    getCurrentPermission: getCur,
    showNotification: async (data) => {
      const granted = await getCur();

      if (granted !== 'granted') {
        return 'not-granted';
      }

      if (!data.options) {
        sendNotification(data.title);
        return createTauriNotification();
      }

      const fullNotification = data.options.data;

      if (fullNotification) {
        const deepLinkUrl = generateDeepLinkUrl(fullNotification);

        sendNotification({
          title: data.title,
          body: data.options.body,
          icon: data.options.icon,
          extra: {
            deepLinkUrl: deepLinkUrl ?? undefined,
          },
        });
      } else {
        const { body, icon, ...rest } = data.options;

        sendNotification({
          title: data.title,
          body,
          icon,
          extra: {
            ...rest,
          },
        });
      }

      return createTauriNotification();
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
