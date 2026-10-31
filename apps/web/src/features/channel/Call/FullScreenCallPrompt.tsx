import { makePersistedState } from '@app/lib/persistence';
import { toast } from '@core/component/Toast/Toast';
import { useTutorialCompleted } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { catchToResult } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { useNotificationSettings } from '@notifications/notification-settings';
import PhoneIncoming from '@phosphor/phone-incoming.svg';
import { useIsAuthenticated } from '@queries/auth';
import { invoke } from '@tauri-apps/api/core';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { z } from 'zod';
import { isNativeCallEnabled } from './native-call-platform';

// Device-wide: the setting belongs to the device, not the signed-in account.
const DISMISSED_KEY = 'full-screen-call-prompt-dismissed';
const dismissedValue = z.literal('true');
const fullScreenIntentState = z.object({ allowed: z.boolean() });

async function canUseFullScreenIntent(): Promise<boolean> {
  return Telemetry.span('call.full_screen_intent.check', async (span) => {
    const result = await catchToResult(() =>
      invoke<unknown>('plugin:call-kit|can_use_full_screen_intent')
    );
    if (result.isErr()) {
      // Builds before this command can't report it; don't prompt there.
      console.error(
        '[callkit] failed to read full-screen intent access',
        result.error
      );
      span.setAttr('call.full_screen_intent.outcome', 'unavailable');
      return true;
    }
    const allowed =
      fullScreenIntentState.safeParse(result.value).data?.allowed ?? true;
    span.setAttr('call.full_screen_intent.outcome', 'checked');
    span.setAttr('call.full_screen_intent.allowed', allowed);
    return allowed;
  });
}

async function openFullScreenIntentSettings(): Promise<void> {
  await Telemetry.span(
    'call.full_screen_intent.open_settings',
    async (span) => {
      const result = await catchToResult(() =>
        invoke('plugin:call-kit|open_full_screen_intent_settings')
      );
      span.setAttr(
        'call.full_screen_intent.outcome',
        result.isOk() ? 'opened' : 'failed'
      );
      if (result.isErr())
        console.error(
          '[callkit] failed to open full-screen intent settings',
          result.error
        );
    }
  );
}

/**
 * Android 14+ revokes full-screen notifications by default, so a ringing call
 * can't open over the lock screen until the user allows them.
 */
export function FullScreenCallPrompt() {
  if (!isPlatform('android') || !isNativeCallEnabled()) return null;

  const settings = useNotificationSettings();
  const isAuthenticated = useIsAuthenticated();
  const tutorialCompleted = useTutorialCompleted();
  const [blocked, setBlocked] = createSignal(false);
  const [dismissed, setDismissed] = makePersistedState(createSignal(false), {
    storages: {
      restore: () =>
        dismissedValue.safeParse(localStorage.getItem(DISMISSED_KEY)).success
          ? true
          : undefined,
      write: (value) => {
        if (value) localStorage.setItem(DISMISSED_KEY, 'true');
      },
    },
  });

  const checkBlocked = async () =>
    setBlocked(!(await canUseFullScreenIntent()));
  onMount(() => fireAndForget(checkBlocked(), 'channel-call'));

  // Calls only ring once notifications are on; that prompt comes first.
  const shouldShow = createMemo(
    () =>
      blocked() &&
      !dismissed() &&
      isAuthenticated() &&
      !!tutorialCompleted() &&
      settings.isSupported &&
      settings.isEnabled()
  );

  // The toast stays up while the user is in Settings; returning rechecks
  // access, and granting it unmounts the toast.
  const recheckOnReturn = () => {
    if (shouldShow()) fireAndForget(checkBlocked(), 'channel-call');
  };
  window.addEventListener('focus', recheckOnReturn);
  onCleanup(() => window.removeEventListener('focus', recheckOnReturn));

  return (
    <Show when={shouldShow()}>
      <FullScreenCallToastTrigger onHide={() => setDismissed(true)} />
    </Show>
  );
}

function FullScreenCallToastTrigger(props: { onHide: () => void }) {
  onMount(() => {
    const toastId = toast.custom(
      {
        title: 'Show Calls on Your Lock Screen',
        icon: PhoneIncoming,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Allow full-screen notifications so incoming calls open even when
            your phone is locked.
          </div>
        ),
        actions: [
          {
            label: 'Hide',
            onClick: () => {
              props.onHide();
              toast.dismiss(toastId);
            },
          },
          {
            label: 'Allow',
            onClick: () =>
              fireAndForget(openFullScreenIntentSettings(), 'channel-call'),
          },
        ],
      },
      { persistent: true }
    );
    onCleanup(() => toast.dismiss(toastId));
  });

  return null;
}
