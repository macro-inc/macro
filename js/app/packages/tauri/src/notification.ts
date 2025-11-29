import type {
  PlatformNotificationHandle,
  PlatformNotificationInterface,
} from '@notifications';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

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
      const { body, icon, ...rest } = data.options;

      sendNotification({
        title: data.title,
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
