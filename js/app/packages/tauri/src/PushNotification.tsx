import { whenSettled } from '@core/util/whenSettled';
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
  createResource,
  createSignal,
  type JSX,
} from 'solid-js';
import { triggerNavigation } from './navigation';
import { createTauriNotificationInterface } from './notification';
import { useExpectTauri } from './TauriProvider';

function usePushNotifications(
  deviceType: 'android' | 'ios',
  onPushNotification?: (event: NotificationEvent) => void
) {
  const [systemPermission] = createResource(checkPermissions);

  const [registrationResult, setRegistrationResult] = makePersisted(
    createSignal<NotificationRegistrationResult | undefined>(undefined)
  );

  const [permission, setPermission] = makePersisted(
    createSignal<'granted' | 'denied' | undefined>(undefined)
  );

  async function registerDeviceWithNotificationService(
    token: string
  ): Promise<'granted' | 'denied'> {
    const res = await notificationServiceClient.registerDevice({
      deviceType,
      token,
    });
    const result = res.isOk() ? ('granted' as const) : ('denied' as const);
    setPermission(result);
    return result;
  }

  async function requestNotificationRegistration() {
    const perm = await requestPermissions();
    if (perm.status !== 'granted') {
      setPermission(undefined);
      setRegistrationResult(undefined);
      return 'denied';
    }
    const reg = await registerForRemoteNotifications();
    if (!reg.token) {
      setPermission(undefined);
      setRegistrationResult(undefined);
      return 'denied';
    }
    setRegistrationResult(reg);
    return await registerDeviceWithNotificationService(reg.token);
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

  // On launch, once permission state resolves, ensure persisted state is synced correct, and check if the APNS token has rotated.
  // iOS returns the same token if valid, or a new one if it has rotated.
  whenSettled(
    systemPermission,
    (perm) => {
      // We defensively ensure our persisted perm state is synced properly, for backwards compatiblity
      if (perm.status !== 'granted') {
        setPermission(undefined);
        return;
      }
      const storedToken = registrationResult()?.token;
      if (!storedToken) {
        setPermission(undefined);
        return;
      }
      if (permission() !== 'granted') {
        setPermission('granted');
      }

      registerForRemoteNotifications()
        .then((freshResult) => {
          if (freshResult.token && freshResult.token !== storedToken) {
            // Best-effort unregister the old token
            notificationServiceClient.unregisterDevice({
              deviceType,
              token: storedToken,
            });
            setRegistrationResult(freshResult);
            registerDeviceWithNotificationService(freshResult.token).catch(
              console.error
            );
          }
        })
        .catch(console.error);
    },
    console.error
  );

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
        const sysPerm = await checkPermissions();
        if (sysPerm.status === 'prompt') {
          return 'default';
        }
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
