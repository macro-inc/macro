import { makePersisted } from '@solid-primitives/storage';
import {
  type Accessor,
  createContext,
  createResource,
  createSignal,
  type JSX,
  type Resource,
  type Setter,
  useContext,
} from 'solid-js';
import { createTabLeaderSignal } from '../notification-election';

type NotGranted = 'not-granted';

/// the context provider value which provides an interface wherein downstream consumers can interact with
// this platforms Notifcation implementation
export interface PlatformNotificationInterface {
  requestPermission: () => Promise<NotificationPermission>;
  getCurrentPermission: () => Promise<NotificationPermission>;
  showNotification: (
    title: string,
    options?: NotificationOptions
  ) => Promise<AppNotification | NotGranted>;
  unregisterNotifications: () => Promise<void>;
}

export type CreateAppNotificationInterface = (
  setDisabled: () => Promise<void>
) => PlatformNotificationInterface;

/// the interface for a singular notification on this device
export interface AppNotification {
  onClick: (cb: () => void) => void;
  close: () => void;
}

export type NotificationUnsupported = 'not-supported';

const ELECTION_NAMESPACE = 'notification-provider';

// create the default browser interface
// this function returns undefined if the browser does not support notifcications
// unregistration is an application detail and isn't actually part of the browser notification api
// which Iis why it is passed in
function createDefaultBrowserInterface(
  unregisterNotifications: () => Promise<void>
): PlatformNotificationInterface | NotificationUnsupported {
  if (!('Notification' in window)) return 'not-supported';

  const isLeader = createTabLeaderSignal(ELECTION_NAMESPACE);

  function getCurrentPermission(): Promise<NotificationPermission> {
    return new Promise((res) => res(window.Notification.permission));
  }

  return {
    requestPermission: () => {
      return window.Notification.requestPermission();
    },
    getCurrentPermission,
    showNotification: async (title, opts) => {
      if (!isLeader()) {
        // treat as no-op
        return 'not-granted';
      }
      const granted = await getCurrentPermission();
      if (granted !== 'granted') {
        return 'not-granted';
      }

      return createBrowserNotication(title, opts);
    },
    unregisterNotifications,
  };
}

function createBrowserNotication(
  title: string,
  opts?: NotificationOptions
): AppNotification {
  const notif = new Notification(title, opts);

  return {
    onClick: (cb) => {
      notif.addEventListener('click', cb);
    },
    close: () => {
      notif.close();
    },
  };
}

const NotificationInterfaceContext = createContext<
  PlatformNotificationInterface | NotificationUnsupported
>('not-supported');

/// this hook gives you access to the raw notification inteferface which is probably not what you want
// you are probably looking for useNotificationState which handles UI disabled notifications
export function usePlatformNotifications():
  | PlatformNotificationInterface
  | NotificationUnsupported {
  const platformNotif = useContext(NotificationInterfaceContext);

  if (platformNotif === undefined) {
    throw new Error(
      'usePlatformNotification did not find a parent NoticationProvider. Please verify the structure of the component tree'
    );
  }

  return platformNotif;
}

type UiDisabled = 'disabled-in-ui';
export type UserSetting = 'allowed' | UiDisabled;

interface PlatformNotificationState {
  permission: Resource<NotificationPermission | UiDisabled>;
  requestPermission: () => Promise<NotificationPermission>;
  unregisterNotification: () => Promise<void>;
  showNotification: (
    title: string,
    opts: NotificationOptions
  ) => Promise<AppNotification | NotGranted | UiDisabled>;
}

export const NotificationStateContext = createContext<
  PlatformNotificationState | NotificationUnsupported | undefined
>(undefined);

export function usePlatformNotificationState():
  | PlatformNotificationState
  | NotificationUnsupported {
  const res = useContext(NotificationStateContext);
  if (res === undefined) {
    console.error(
      new Error(
        'tried to useNotificationState outside of a NotificationStateProvider'
      )
    );
    return 'not-supported';
  }
  return res;
}

function PlatformNotificationState(props: {
  children: JSX.Element;
  manuallyDisabled: Accessor<UserSetting>;
  setManuallyDisabled: Setter<UserSetting>;
}) {
  const platformNotif = usePlatformNotifications();

  // this is not a reactive value (can't change) so we can have conditional hooks
  if (platformNotif === 'not-supported') {
    return props.children;
  }

  const [permission, { refetch }] = createResource(
    props.manuallyDisabled,
    async (disabled) => {
      if (disabled === 'disabled-in-ui') {
        return disabled;
      }
      return await platformNotif.getCurrentPermission();
    }
  );

  async function requestPermission() {
    if (platformNotif === 'not-supported') {
      console.warn(
        'requested notification permission on an unsupported platform'
      );
      return 'denied';
    }
    props.setManuallyDisabled('allowed');
    const res = await platformNotif.requestPermission();
    await refetch();
    return res;
  }

  async function showNotification(
    title: string,
    opts: NotificationOptions
  ): Promise<AppNotification | NotGranted | UiDisabled> {
    const manuallyDisabled = props.manuallyDisabled();
    if (manuallyDisabled === 'disabled-in-ui') {
      return manuallyDisabled;
    }

    if (permission.latest !== 'granted' || platformNotif === 'not-supported') {
      return 'not-granted';
    }

    return await platformNotif.showNotification(title, opts);
  }

  return (
    <NotificationStateContext.Provider
      value={{
        permission,
        requestPermission,
        unregisterNotification: platformNotif.unregisterNotifications,
        showNotification,
      }}
    >
      {props.children}
    </NotificationStateContext.Provider>
  );
}

export function PlatformNotificationProvider(props: {
  children: JSX.Element;
  overrideDefault?: CreateAppNotificationInterface;
}) {
  const [manuallyDisabled, setManuallyDisabled] = makePersisted(
    createSignal<UserSetting>('allowed')
  );

  const setDisabled = async () => {
    setManuallyDisabled('disabled-in-ui');
  };

  const value = (props.overrideDefault ?? createDefaultBrowserInterface)(
    setDisabled
  );

  return (
    <NotificationInterfaceContext.Provider value={value}>
      <PlatformNotificationState
        manuallyDisabled={manuallyDisabled}
        setManuallyDisabled={setManuallyDisabled}
      >
        {props.children}
      </PlatformNotificationState>
    </NotificationInterfaceContext.Provider>
  );
}
