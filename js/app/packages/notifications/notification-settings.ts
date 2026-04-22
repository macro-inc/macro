import type { Accessor, Resource } from 'solid-js';
import { createSignal } from 'solid-js';
import {
  type PlatformNotificationState,
  usePlatformNotificationState,
} from './components/PlatformNotificationProvider';

type UiDisabled = 'disabled-in-ui';

function createPersistedDismissed(
  key: string
): [isDismissed: Accessor<boolean>, dismiss: () => void] {
  const [isDismissed, setIsDismissed] = createSignal(
    !!localStorage.getItem(key)
  );

  const dismiss = () => {
    localStorage.setItem(key, 'true');
    setIsDismissed(true);
  };

  return [isDismissed, dismiss];
}

function createIsEnabled(
  permission: Resource<NotificationPermission | UiDisabled>
): Accessor<boolean> {
  return () => permission.latest === 'granted';
}

function createCanPrompt(
  permission: Resource<NotificationPermission | UiDisabled>
): Accessor<boolean> {
  return () => {
    const p = permission();
    return (
      p !== undefined &&
      p !== 'granted' &&
      p !== 'denied' &&
      p !== 'disabled-in-ui'
    );
  };
}

function createShouldPrompt(
  canPrompt: Accessor<boolean>,
  isDismissed: Accessor<boolean>
): Accessor<boolean> {
  return () => canPrompt() && !isDismissed();
}

function createToggle(
  state: PlatformNotificationState
): (enabled: boolean) => Promise<void> {
  return async (enabled: boolean) => {
    if (enabled) {
      await state.requestPermission();
    } else {
      await state.unregisterNotification();
    }
  };
}

const PROMPT_DISMISSED_KEY = 'notification-prompt-dismissed';

export type SupportedNotificationSettings = {
  isSupported: true;
  /** Whether notifications are currently enabled (granted and not disabled in UI) */
  isEnabled: Accessor<boolean>;
  /**
   * Whether the user currently has a path to enable notifications.
   * Returns false while the permission resource is still loading, and
   * false when permission is granted, denied, or disabled in the UI.
   */
  canPrompt: Accessor<boolean>;
  /** Toggle notifications on/off */
  toggle: (enabled: boolean) => Promise<void>;
  /** Whether the enable prompt should be shown (can prompt and not dismissed) */
  shouldPrompt: Accessor<boolean>;
  /** Dismiss the enable prompt */
  dismissPrompt: () => void;
};

export type NotificationSettings =
  | SupportedNotificationSettings
  | { isSupported: false };

export function useNotificationSettings(): NotificationSettings {
  const state = usePlatformNotificationState();

  if (state === 'not-supported') {
    return { isSupported: false };
  }

  const [isDismissed, dismissPrompt] =
    createPersistedDismissed(PROMPT_DISMISSED_KEY);

  const canPrompt = createCanPrompt(state.permission);

  return {
    isSupported: true,
    isEnabled: createIsEnabled(state.permission),
    canPrompt,
    toggle: createToggle(state),
    shouldPrompt: createShouldPrompt(canPrompt, isDismissed),
    dismissPrompt,
  };
}
