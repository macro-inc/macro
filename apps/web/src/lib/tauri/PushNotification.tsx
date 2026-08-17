import {
  registerPushRegistrationLifecycle,
  syncPushRegistrations,
} from '@core/auth/push-registration-lifecycle';
import { hasLoginCookie } from '@core/util/cookies';
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
  triggerNotificationNavigation,
} from '@notifications';
import { notificationServiceClient } from '@service-notification/client';
import { makePersisted } from '@solid-primitives/storage';
import { removeAllActive } from '@tauri-apps/plugin-notification';
import {
  createContext,
  createEffect,
  createResource,
  createSignal,
  type JSX,
  onCleanup,
} from 'solid-js';
import { createTauriNotificationInterface } from './notification';
import { useExpectTauri } from './TauriProvider';

function getNotificationId(payload: Record<string, unknown>) {
  const value = payload.notificationId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

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

  // Tracks an explicit in-app opt-out, as opposed to a logout or a fresh
  // login/account-switch. Only this flag should suppress the automatic
  // re-registration in syncDeviceRegistration; registrationResult/permission
  // are cleared on logout too and can't be used to detect opt-out.
  const [pushDisabledByUser, setPushDisabledByUser] = makePersisted(
    createSignal(false)
  );

  async function registerDeviceWithNotificationService(
    token: string
  ): Promise<'granted' | 'denied'> {
    const res = await notificationServiceClient.registerDevice({
      deviceType,
      token,
    });
    if (res.isErr()) {
      // A failed registration is always a transient condition (network blip,
      // auth still settling, backend error) — the endpoint has no "rejected"
      // semantics. Only success may write the persisted state: flipping it to
      // 'denied' here would disable remote-push dedupe and report push as off
      // in Settings until the next successful sync.
      console.error('failed to register device for push', res.error);
      return 'denied';
    }
    setPermission('granted');
    setPushDisabledByUser(false);
    return 'granted';
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
      const res = await notificationServiceClient.unregisterDevice({
        deviceType,
        token,
      });
      if (res.isErr()) {
        console.error('failed to unregister device for push', res.error);
      }
    } else {
      console.warn('Cannot unregister device with no token set');
    }
    setRegistrationResult(undefined);
    setPermission(undefined);
    setPushDisabledByUser(true);
  }

  // (Re-)register this device under whoever is currently logged in. The
  // backend keys a token to a single user, so this must run on every login —
  // not just when the APNs token rotates — or the previous account keeps
  // receiving this device's pushes.
  async function syncDeviceRegistration() {
    if (pushDisabledByUser()) return;
    const sysPerm = await checkPermissions();
    if (sysPerm.status !== 'granted') return;
    const freshResult = await registerForRemoteNotifications();
    if (!freshResult.token) return;
    const storedToken = registrationResult()?.token;
    if (storedToken && storedToken !== freshResult.token) {
      // Best-effort: unregister the old token
      notificationServiceClient
        .unregisterDevice({ deviceType, token: storedToken })
        .catch(console.error);
    }
    setRegistrationResult(freshResult);
    const result = await registerDeviceWithNotificationService(
      freshResult.token
    );
    if (result !== 'granted') {
      // Surface the failure so the lifecycle's retry (and its logging) see it.
      throw new Error('push device registration did not complete');
    }
  }

  async function unregisterForLogout() {
    // The logged-out account's already-delivered notifications must not
    // linger in the system notification center for the next account to see.
    await Promise.all([
      removeAllActive().catch(console.error),
      unregisterPushNotifications(),
    ]);
    // unregisterPushNotifications() sets pushDisabledByUser, but that's an
    // opt-out for this account, not the next one that logs in on this device.
    setPushDisabledByUser(false);
  }

  const removeLifecycle = registerPushRegistrationLifecycle({
    syncRegistration: syncDeviceRegistration,
    unregisterForLogout,
  });
  onCleanup(removeLifecycle);

  // On launch, once permission state resolves, ensure persisted state is
  // synced correctly and — when a session exists — re-register the device so
  // the backend registration tracks the current user (covering both an APNs
  // token rotation and an account switch since the last launch).
  whenSettled(
    systemPermission,
    (perm) => {
      // OS permission was revoked externally (iOS Settings) — clear the
      // persisted registration state so it never claims 'granted' when
      // notifications can't display.
      if (perm.status !== 'granted') {
        setPermission(undefined);
        return;
      }
      if (!hasLoginCookie()) {
        // Logged out: nothing to register against; login will sync.
        return;
      }
      // Sync via the lifecycle registry so the launch path gets the same
      // one-retry behavior as login (registrations are idempotent).
      syncPushRegistrations().catch(console.error);
    },
    console.error
  );

  const [notificationWatchStarted, setNotificationWatchStarted] =
    createSignal(false);
  createEffect(() => {
    if (!registrationResult()?.success || !onPushNotification) return;
    if (notificationWatchStarted()) return;

    setNotificationWatchStarted(true);
    void watchNotifications(onPushNotification).catch(() => {
      setNotificationWatchStarted(false);
    });
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
    const notificationId = getNotificationId(event.payload);

    const tapped =
      event.type === 'BACKGROUND_TAP' || event.type === 'FOREGROUND_TAP';

    // Only navigate on explicit user interaction.
    if (!tapped) return;
    if (!notificationId) return;

    triggerNotificationNavigation(notificationId);
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
