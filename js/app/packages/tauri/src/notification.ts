import type {
  AppNotification,
  AppNotificationInterface,
} from '@macro/notification-provider';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

export function createTauriNotificationInterface(
  setDisabled: () => Promise<void>
): AppNotificationInterface {
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
    showNotification: async (title, opts) => {
      const granted = await getCur();

      if (granted !== 'granted') {
        return 'not-granted';
      }

      if (!opts) {
        sendNotification(title);
        return createTauriNotification();
      }
      const { body, icon, ...rest } = opts;

      sendNotification({
        title,
        body,
        icon,
        extra: {
          ...rest,
        },
      });
      return createTauriNotification();
    },
    unregisterNotifications: setDisabled,
  };
}

function createTauriNotification(): AppNotification {
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
