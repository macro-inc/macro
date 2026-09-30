import * as ios from '@inkibra/tauri-plugins/packages/tauri-plugin-notifications';
import { Channel, invoke } from '@tauri-apps/api/core';

type LifecycleEvent<Type extends 'TOKEN_REFRESH' | 'RESUME'> = {
  type: Type;
  payload: Record<string, string>;
};

// One member per lifecycle type so a handler that returns early on them
// narrows the rest to NotificationEvent.
export type PushEvent =
  | (ios.NotificationEvent & { deliveryId?: string })
  | LifecycleEvent<'TOKEN_REFRESH'>
  | LifecycleEvent<'RESUME'>;

/** Keep the Android bridge separate from the existing iOS plugin contract. */
export function createPushApi(platform: 'android' | 'ios') {
  const android = platform === 'android';
  return {
    checkPermissions: () =>
      android
        ? invoke<ios.NotificationPermissionStatus>(
            'plugin:android-push|check_permissions'
          )
        : ios.checkPermissions(),
    requestPermissions: () =>
      android
        ? invoke<ios.NotificationPermissionStatus>(
            'plugin:android-push|request_permissions'
          )
        : ios.requestPermissions(),
    register: () =>
      android
        ? invoke<ios.NotificationRegistrationResult>(
            'plugin:android-push|register'
          )
        : ios.registerForRemoteNotifications(),
    configureRecipient: async (recipientId: string | null) => {
      if (android)
        await invoke('plugin:android-push|configure', {
          payload: { recipientId },
        });
    },
    watch: async (callback: (event: PushEvent) => void) => {
      if (!android) {
        await ios.watchNotifications(callback);
        return;
      }
      const channel = new Channel<PushEvent>();
      channel.onmessage = callback;
      await invoke('plugin:android-push|watch', { channel });
    },
    unwatch: async () => {
      if (android) await invoke('plugin:android-push|unwatch');
    },
    acknowledge: async (deliveryId: string) => {
      if (android)
        await invoke('plugin:android-push|acknowledge', {
          payload: { deliveryId },
        });
    },
  };
}
