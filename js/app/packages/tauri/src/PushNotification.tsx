import { isOk } from '@core/util/maybeResult';
import {
  checkPermissions,
  type NotificationEvent,
  type NotificationRegistrationResult,
  registerForRemoteNotifications,
  requestPermissions,
  watchNotifications,
} from '@inkibra/tauri-plugins/packages/tauri-plugin-notifications';
import {
  type PlatformNotificationInterface,
  PlatformNotificationProvider,
} from '@notifications';
import { invalidateUserNotifications } from '@queries/notification/user-notifications';
import { notificationServiceClient } from '@service-notification/client';
import { makePersisted } from '@solid-primitives/storage';
import {
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onMount,
} from 'solid-js';
import { triggerNavigation } from './navigation';
import { createTauriNotificationInterface } from './notification';
import { useExpectTauri } from './TauriProvider';

function usePushNotifications(
  deviceType: 'android' | 'ios',
  onPushNotification?: (event: NotificationEvent) => void
) {
  const [registrationResult, setRegistrationResult] = makePersisted(
    createSignal<NotificationRegistrationResult | undefined>(undefined)
  );

  const [permission, setPermission] = makePersisted(
    createSignal<'granted' | 'denied' | undefined>(undefined)
  );

  async function registerDevice(token: string): Promise<'granted' | 'denied'> {
    const res = await notificationServiceClient.registerDevice({
      deviceType,
      token,
    });
    const result = isOk(res) ? ('granted' as const) : ('denied' as const);
    setPermission(result);
    return result;
  }

  async function requestNotificationRegistration() {
    const perm = await requestPermissions();
    if (perm.status !== 'granted') return 'denied';
    const reg = await registerForRemoteNotifications();
    setRegistrationResult(reg);
    if (!reg.token) return 'denied';
    return await registerDevice(reg.token);
  }

  async function unregisterPushNotifications() {
    const token = registrationResult()?.token;

    if (token) {
      await notificationServiceClient.unregisterDevice({
        deviceType,
        token,
      });
    } else {
      console.warn('Cannot unregister device with no token set');
    }
    setRegistrationResult(undefined);
    setPermission(undefined);
  }

  // On launch, check if the APNS token has rotated.
  // iOS returns the same token if valid, or a new one if it has rotated.
  onMount(async () => {
    try {
      const perm = await checkPermissions();
      if (perm.status !== 'granted') return;
      const storedToken = registrationResult()?.token;
      if (!storedToken) return;

      const freshResult = await registerForRemoteNotifications();
      if (freshResult.token && freshResult.token !== storedToken) {
        // Best-effort unregister the old token
        notificationServiceClient.unregisterDevice({
          deviceType,
          token: storedToken,
        });
        setRegistrationResult(freshResult);
        void registerDevice(freshResult.token);
      }
    } catch (e) {
      console.error(e);
    }
  });

  createEffect(() => {
    if (!registrationResult()?.success || !onPushNotification) return;
    watchNotifications(onPushNotification).then(console.info);
  });

  return {
    permission,
    requestNotificationRegistration,
    registrationResult,
    unregisterPushNotifications,
  };
}

type ContextVal = ReturnType<typeof usePushNotifications>;

const PushNotificationContext = createContext<
  ContextVal | 'not-supported' | undefined
>(undefined);

/// component which will register push
export function MaybePushNotificationRegistration(props: {
  children: JSX.Element;
}) {
  const { os } = useExpectTauri();

  if (os !== 'android' && os !== 'ios') {
    return (
      <PushNotificationContext.Provider value={'not-supported'}>
        <PlatformNotificationProvider
          overrideDefault={createTauriNotificationInterface}
        >
          {props.children}
        </PlatformNotificationProvider>
      </PushNotificationContext.Provider>
    );
  }

  const push = usePushNotifications(os, (event) => {
    const notificationId: string | undefined = event.payload.notificationId;

    const tapped =
      event.type === 'BACKGROUND_TAP' || event.type === 'FOREGROUND_TAP';
    // Only navigate on explicit user interaction.
    if (!tapped) return;
    if (!notificationId) return;

    invalidateUserNotifications();
    triggerNavigation(
      `/component/notification?notificationId=${notificationId}`
    );
  });

  // now we compose the standard tauri notif plugin with the push notification plugin
  function curriedTauriPushNotification(
    setDisabled: () => Promise<void>
  ): PlatformNotificationInterface {
    const {
      requestPermission,
      unregisterNotifications,
      getCurrentPermission,
      showNotification: baseShowNotification,
    } = createTauriNotificationInterface(setDisabled);

    return {
      showNotification: async (data) => {
        // If remote push is enabled, the OS will display notifications for us.
        // Avoid also generating a local notification from websocket events,
        // which would cause duplicates.
        if (push.permission() === 'granted') {
          return 'not-granted';
        }
        return baseShowNotification(data);
      },
      getCurrentPermission: async () => {
        const appNotification = await getCurrentPermission();
        if (appNotification === 'granted' && push.permission() === 'granted') {
          return 'granted';
        }
        return 'denied';
      },
      requestPermission: async () => {
        const res = await requestPermission();
        const next = await push.requestNotificationRegistration();
        return next === 'granted' && res === 'granted' ? 'granted' : 'denied';
      },
      unregisterNotifications: async () => {
        await push.unregisterPushNotifications();
        return await unregisterNotifications();
      },
    };
  }

  return (
    <PushNotificationContext.Provider value={push}>
      <PlatformNotificationProvider
        overrideDefault={curriedTauriPushNotification}
      >
        {props.children}
      </PlatformNotificationProvider>
    </PushNotificationContext.Provider>
  );
}
