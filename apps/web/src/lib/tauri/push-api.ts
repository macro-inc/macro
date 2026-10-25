import * as ios from '@inkibra/tauri-plugins/packages/tauri-plugin-notifications';
import { Channel, invoke } from '@tauri-apps/api/core';

type LifecycleEvent<Type extends 'TOKEN_REFRESH' | 'RESUME'> = {
  type: Type;
  payload: Record<string, string>;
};

// One member per lifecycle type so a handler that returns early on them
// narrows the rest to NotificationEvent.
export type PushEvent =
  | (ios.NotificationEvent & { deliveryId?: string; receivedAtMs?: number })
  | LifecycleEvent<'TOKEN_REFRESH'>
  | LifecycleEvent<'RESUME'>;

declare global {
  interface Window {
    __MACRO_IOS_NOTIFICATION_LAUNCH__?: boolean;
  }
}

export function supportsNotificationLaunch(): boolean {
  return window.__MACRO_IOS_NOTIFICATION_LAUNCH__ === true;
}

/** Reveal auth/retry UI without discarding the durable tapped destination. */
export async function releaseNotificationCover(): Promise<void> {
  if (supportsNotificationLaunch())
    await invoke('plugin:notifications|release_notification_cover');
}

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
      else if (supportsNotificationLaunch())
        await invoke('plugin:notifications|configure_recipient', {
          payload: { recipientId },
        });
    },
    watch: async (callback: (event: PushEvent) => void) => {
      if (!android && !supportsNotificationLaunch()) {
        await ios.watchNotifications(callback);
        return;
      }
      const channel = new Channel<PushEvent>();
      channel.onmessage = callback;
      await invoke(
        android
          ? 'plugin:android-push|watch'
          : 'plugin:notifications|watch_notifications',
        {
          channel,
          ...(!android ? { launchAware: true } : {}),
        }
      );
    },
    unwatch: async () => {
      if (android) await invoke('plugin:android-push|unwatch');
      else if (supportsNotificationLaunch())
        await invoke('plugin:notifications|unwatch_notifications');
    },
    acknowledge: async (deliveryId: string) => {
      if (android)
        await invoke('plugin:android-push|acknowledge', {
          payload: { deliveryId },
        });
      else if (supportsNotificationLaunch()) {
        // Let the destination's route/loading shell draw before native removes
        // its resume cover. In the background this waits until the next frame.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        await invoke('plugin:notifications|acknowledge_notification', {
          deliveryId,
        });
      }
    },
    pending: () =>
      invoke<PushEvent | null>('plugin:notifications|get_pending_notification'),
    clearPending: async () => {
      if (supportsNotificationLaunch())
        await invoke('plugin:notifications|clear_pending_notification');
    },
  };
}
