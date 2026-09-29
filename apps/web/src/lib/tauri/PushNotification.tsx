import {
  registerPushRegistrationLifecycle,
  syncPushRegistrations,
} from '@core/auth/push-registration-lifecycle';
import { hasLoginCookie } from '@core/util/cookies';
import type {
  NotificationEvent,
  NotificationRegistrationResult,
} from '@inkibra/tauri-plugins/packages/tauri-plugin-notifications';
import {
  type PlatformNotificationInterface,
  PlatformNotificationProvider,
  triggerNotificationNavigation,
} from '@notifications';
import {
  fetchPushRecipient,
  registerPushDevice,
  unregisterPushDevice,
} from '@queries/notification/device-registration';
import { makePersisted } from '@solid-primitives/storage';
import { removeAllActive } from '@tauri-apps/plugin-notification';
import {
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
} from 'solid-js';
import { createTauriNotificationInterface } from './notification';
import { createPushApi, type PushEvent } from './push-api';
import { useExpectTauri } from './TauriProvider';

function getNotificationId(payload: Record<string, unknown>) {
  const value = payload.notificationId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function usePushNotifications(
  deviceType: 'android' | 'ios',
  onPushNotification?: (event: NotificationEvent) => void
) {
  const api = createPushApi(deviceType);
  // Bumped by every registration-changing action so an in-flight one can
  // detect it was superseded (logout, opt-out, a newer sync) and stop.
  let registrationEpoch = 0;
  let disposed = false;
  let requestingPermission = false;
  let notificationWatchStarted = false;

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

  function isStale(epoch: number) {
    return epoch !== registrationEpoch;
  }

  async function registerDeviceWithNotificationService(
    token: string,
    epoch: number
  ): Promise<'granted' | 'denied'> {
    const recipient = await fetchRecipient();
    if (recipient === undefined) return 'denied';
    if (isStale(epoch) || !hasLoginCookie()) return 'denied';
    const res = await registerPushDevice({
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
    if (isStale(epoch) || !hasLoginCookie()) return 'denied';
    await api.configureRecipient(recipient);
    if (isStale(epoch)) return 'denied';
    setPermission('granted');
    setPushDisabledByUser(false);
    await startWatch();
    return 'granted';
  }

  // The native receiver only displays pushes addressed to this account, so
  // Android needs the user id before it can be armed. iOS has no such gate.
  async function fetchRecipient(): Promise<string | null | undefined> {
    if (deviceType !== 'android') return null;
    try {
      return await fetchPushRecipient();
    } catch (error) {
      // Transient like a failed registration: leave persisted state alone so
      // the lifecycle retry gets another go.
      console.error('failed to resolve push recipient', error);
      return undefined;
    }
  }

  async function requestNotificationRegistration() {
    requestingPermission = true;
    try {
      return await requestAndRegister();
    } finally {
      requestingPermission = false;
    }
  }

  async function requestAndRegister() {
    const epoch = ++registrationEpoch;
    const perm = await api.requestPermissions();
    if (isStale(epoch)) return 'denied';
    if (perm.status !== 'granted') {
      setPermission(undefined);
      setRegistrationResult(undefined);
      await api.configureRecipient(null);
      return 'denied';
    }
    const reg = await api.register();
    if (isStale(epoch)) return 'denied';
    if (!reg.token) {
      console.error('push registration returned no token', reg.error);
      setPermission(undefined);
      setRegistrationResult(undefined);
      return 'denied';
    }
    setRegistrationResult(reg);
    return await registerDeviceWithNotificationService(reg.token, epoch);
  }

  async function unregisterPushNotifications(disabledByUser = true) {
    ++registrationEpoch;
    const token = registrationResult()?.token;
    setPermission(undefined);
    setPushDisabledByUser(disabledByUser);
    setRegistrationResult(undefined);
    await api.configureRecipient(null);

    if (token) {
      const res = await unregisterPushDevice({
        deviceType,
        token,
      });
      if (res.isErr()) {
        console.error('failed to unregister device for push', res.error);
      }
    } else {
      console.warn('Cannot unregister device with no token set');
    }
  }

  // (Re-)register this device under whoever is currently logged in. The
  // backend keys a token to a single user, so this must run on every login —
  // not just when the APNs token rotates — or the previous account keeps
  // receiving this device's pushes.
  async function syncDeviceRegistration() {
    if (
      disposed ||
      requestingPermission ||
      pushDisabledByUser() ||
      !hasLoginCookie()
    )
      return;
    const epoch = ++registrationEpoch;
    const sysPerm = await api.checkPermissions();
    if (isStale(epoch)) return;
    if (sysPerm.status !== 'granted') {
      setPermission(undefined);
      await api.configureRecipient(null);
      const token = registrationResult()?.token;
      if (deviceType === 'android' && token) {
        const result = await unregisterPushDevice({ deviceType, token });
        if (result.isErr())
          throw new Error('push permission revocation sync failed');
      }
      return;
    }
    const freshResult = await api.register();
    if (isStale(epoch)) return;
    if (!freshResult.token) {
      console.error('push registration returned no token', freshResult.error);
      return;
    }
    const storedToken = registrationResult()?.token;
    if (storedToken && storedToken !== freshResult.token) {
      // Best-effort: unregister the old token
      try {
        await unregisterPushDevice({ deviceType, token: storedToken });
      } catch (error) {
        console.error('failed to unregister rotated push token', error);
      }
    }
    if (isStale(epoch)) return;
    setRegistrationResult(freshResult);
    const result = await registerDeviceWithNotificationService(
      freshResult.token,
      epoch
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
      clearDisplayedNotifications(),
      unregisterPushNotifications(false),
    ]);
  }

  async function clearDisplayedNotifications() {
    try {
      await removeAllActive();
    } catch (error) {
      console.error(error);
    }
  }

  const removeLifecycle = registerPushRegistrationLifecycle({
    syncRegistration: syncDeviceRegistration,
    unregisterForLogout,
  });
  onCleanup(removeLifecycle);
  onCleanup(() => {
    disposed = true;
    ++registrationEpoch;
    void stopWatch();
  });

  async function stopWatch() {
    try {
      await api.unwatch();
    } catch (error) {
      console.error(error);
    }
  }

  // On launch, re-register the device so the backend registration tracks the
  // current user (covering both a token rotation and an account switch since
  // the last launch). The lifecycle sync also clears state when the OS
  // permission was revoked; only the cases it skips are handled here.
  void reconcileOnLaunch();

  async function reconcileOnLaunch() {
    try {
      if (!hasLoginCookie() || pushDisabledByUser()) {
        setPermission(undefined);
        await api.configureRecipient(null);
        return;
      }
      await syncPushRegistrations('resume');
    } catch (error) {
      console.error('push launch sync failed', error);
    }
  }

  createEffect(() => {
    if (!onPushNotification) return;
    if (deviceType === 'ios' && !registrationResult()?.success) return;
    void startWatch();
  });

  async function startWatch() {
    if (disposed || notificationWatchStarted || !onPushNotification) return;
    notificationWatchStarted = true;
    try {
      if (deviceType === 'android' && !hasLoginCookie())
        await api.configureRecipient(null);
      await api.watch((event) => {
        void handlePushEvent(event);
      });
      if (disposed) await api.unwatch();
    } catch (error) {
      notificationWatchStarted = false;
      console.error('failed to watch push notifications', error);
    }
  }

  async function handlePushEvent(event: PushEvent) {
    if (disposed || !hasLoginCookie()) return;
    try {
      if (event.type === 'TOKEN_REFRESH' || event.type === 'RESUME') {
        await syncPushRegistrations('resume');
        return;
      }
      onPushNotification?.(event);
      if (event.deliveryId) await api.acknowledge(event.deliveryId);
    } catch (error) {
      console.error('push event handling failed', error);
    }
  }

  return {
    permission,
    requestNotificationRegistration,
    registrationResult,
    unregisterPushNotifications,
    checkPermissions: api.checkPermissions,
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

  if (os !== 'ios' && os !== 'android') {
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
        const sysPerm = await push.checkPermissions();
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
