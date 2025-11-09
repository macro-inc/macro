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
  type AppNotificationInterface,
  PlatformNotificationProvider,
} from '@macro/notification-provider';
import { notificationServiceClient } from '@service-notification/client';
import { makePersisted } from '@solid-primitives/storage';
import {
  type Accessor,
  createContext,
  createEffect,
  createResource,
  createSignal,
  type JSX,
  type Setter,
} from 'solid-js';
import { createTauriNotificationInterface } from './notification';
import { useExpectTauri } from './TauriProvider';

function usePushNotifications(
  deviceType: 'android' | 'ios',
  onPushNotification?: (event: NotificationEvent) => void
) {
  const [systemPermission, { refetch }] = createResource(checkPermissions);

  const [registrationResult, setRegistrationResult] = makePersisted(
    createSignal<NotificationRegistrationResult | undefined>(undefined)
  );

  /// signal which returns the value of the system push notification token
  // only if the system permission status is granted
  const tokenToSend = () => {
    if (systemPermission.latest?.status !== 'granted') return undefined;
    return registrationResult()?.token;
  };

  const createResourceStorage = (): [
    Accessor<'granted' | 'denied' | undefined>,
    Setter<'granted' | 'denied' | undefined>,
  ] => {
    const [get, set] = makePersisted(
      createSignal<'granted' | 'denied' | undefined>(undefined)
    );
    return [get, set];
  };
  const [permission, { refetch: reloadServer }] = createResource<
    'granted' | 'denied',
    string
  >(
    tokenToSend,
    async (token) => {
      const res = await notificationServiceClient.registerDevice({
        deviceType,
        token,
      });
      return isOk(res) ? 'granted' : 'denied';
    },
    { storage: createResourceStorage }
  );

  async function requestNotificationRegistration() {
    const perm = await requestPermissions();
    await refetch();
    if (perm.status !== 'granted') return 'denied';
    const reg = await registerForRemoteNotifications();
    setRegistrationResult(reg);
    await reloadServer();
    return permission.latest!;
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
  }

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

  const push = usePushNotifications(os);

  // now we compose the standard tauri notif plugin with the push notification plugin
  function curriedTauriPushNotification(
    setDisabled: () => Promise<void>
  ): AppNotificationInterface {
    const {
      requestPermission,
      unregisterNotifications,
      getCurrentPermission,
      showNotification,
    } = createTauriNotificationInterface(setDisabled);

    return {
      showNotification,
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
