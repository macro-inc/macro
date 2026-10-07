import type {
  PlatformNotificationHandle,
  PlatformNotificationInterface,
} from '@notifications';
import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { type as osType } from '@tauri-apps/plugin-os';

export function createTauriNotificationInterface(
  setDisabled: () => Promise<void>,
  shouldSend: () => boolean = () => true
): PlatformNotificationInterface {
  let hasMacOSPermissionCommands = osType() === 'macos';

  async function getCur(): Promise<NotificationPermission> {
    // The notification plugin always reports permission as granted on desktop.
    // Read the actual OS authorization on macOS instead.
    if (hasMacOSPermissionCommands) {
      try {
        return await invoke<NotificationPermission>(
          'get_macos_notification_permission'
        );
      } catch (error) {
        // Older native builds can receive this frontend through an OTA update.
        // Preserve their existing behavior only when the command is absent.
        if (error !== 'Command get_macos_notification_permission not found') {
          throw error;
        }
        hasMacOSPermissionCommands = false;
      }
    }
    return (await isPermissionGranted()) ? 'granted' : 'denied';
  }
  return {
    requestPermission: async () => {
      const cur = await getCur();
      if (cur === 'granted') {
        return 'granted';
      }
      if (hasMacOSPermissionCommands) {
        // macOS will not prompt again after denial; permission must be changed
        // in System Settings.
        if (cur === 'denied') return 'denied';
        return await invoke<NotificationPermission>(
          'request_macos_notification_permission'
        );
      }
      return await requestPermission();
    },
    getCurrentPermission: getCur,
    showNotification: async (data) => {
      const granted = await getCur();

      // A user can disable notifications while the native permission check
      // is in flight. Check the current preference just before dispatching.
      if (granted !== 'granted' || !shouldSend()) {
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
    onDismiss: (_cb) => {
      console.warn(
        'notification on dismiss is not yet supported on this platform'
      );
    },
    close() {
      console.warn('notification close is not yet supported on this platform');
    },
  };
}
