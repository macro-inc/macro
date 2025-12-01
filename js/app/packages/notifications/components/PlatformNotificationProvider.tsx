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
import type {
  PlatformNotificationData,
  PlatformNotificationHandle,
} from '../notification-platform';

type NotGranted = 'not-granted';

/// the context provider value which provides an interface wherein downstream consumers can interact with
// this platforms Notifcation implementation
export interface PlatformNotificationInterface {
  requestPermission: () => Promise<NotificationPermission>;
  getCurrentPermission: () => Promise<NotificationPermission>;
  showNotification: (
    data: PlatformNotificationData
  ) => Promise<PlatformNotificationHandle | NotGranted>;
  unregisterNotifications: () => Promise<void>;
}

export type CreateAppNotificationInterface = (
  setDisabled: () => Promise<void>
) => PlatformNotificationInterface;

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
    showNotification: async (data: PlatformNotificationData) => {
      if (!isLeader()) {
        // treat as no-op
        return 'not-granted';
      }
      const granted = await getCurrentPermission();
      if (granted !== 'granted') {
        return 'not-granted';
      }

      return createBrowserNotication(data);
    },
    unregisterNotifications,
  };
}

function createBrowserNotication(
  data: PlatformNotificationData
): PlatformNotificationHandle {
  const notif = new Notification(data.title, data.options);

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

export interface PlatformNotificationState {
  permission: Resource<NotificationPermission | UiDisabled>;
  requestPermission: () => Promise<NotificationPermission>;
  unregisterNotification: () => Promise<void>;
  showNotification: (
    data: PlatformNotificationData
  ) => Promise<PlatformNotificationHandle | NotGranted | UiDisabled>;
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

const PROMPT_DISMISSED_KEY = 'notification-prompt-dismissed';

export type NotificationSettings =
  | {
      isSupported: true;
      /** Whether notifications are currently enabled (granted and not disabled in UI) */
      isEnabled: () => boolean;
      /** Toggle notifications on/off */
      toggle: (enabled: boolean) => Promise<void>;
      /** Whether the enable prompt should be shown (permission not yet decided, not dismissed) */
      shouldPrompt: () => boolean;
      /** Dismiss the enable prompt */
      dismissPrompt: () => void;
    }
  | {
      isSupported: false;
    };

export function useNotificationSettings(): NotificationSettings {
  const state = usePlatformNotificationState();

  if (state === 'not-supported') {
    return { isSupported: false };
  }

  const [isPromptDismissed, setIsPromptDismissed] = createSignal(
    !!localStorage.getItem(PROMPT_DISMISSED_KEY)
  );

  const isEnabled = () => state.permission.latest === 'granted';

  const toggle = async (enabled: boolean) => {
    if (enabled) {
      await state.requestPermission();
    } else {
      await state.unregisterNotification();
    }
  };

  const shouldPrompt = () => {
    if (isPromptDismissed()) return false;
    const permission = state.permission();
    return (
      permission !== undefined &&
      permission !== 'granted' &&
      permission !== 'denied' &&
      permission !== 'disabled-in-ui'
    );
  };

  const dismissPrompt = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, 'true');
    setIsPromptDismissed(true);
  };

  return {
    isSupported: true,
    isEnabled,
    toggle,
    shouldPrompt,
    dismissPrompt,
  };
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
    data: PlatformNotificationData
  ): Promise<PlatformNotificationHandle | NotGranted | UiDisabled> {
    const manuallyDisabled = props.manuallyDisabled();
    if (manuallyDisabled === 'disabled-in-ui') {
      return manuallyDisabled;
    }

    if (permission.latest !== 'granted' || platformNotif === 'not-supported') {
      return 'not-granted';
    }

    return await platformNotif.showNotification(data);
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
    createSignal<UserSetting>('allowed'),
    { name: 'notification-manually-disabled' }
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
