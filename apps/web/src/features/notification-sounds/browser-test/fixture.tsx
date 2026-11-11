import '@fontsource-variable/inter';
import '../../../index.css';
import { fireAndForget } from '@core/util/fireAndForget';
import type { UnifiedNotification } from '@notifications/types';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { createCallSoundPlayer } from '../../channel/Call/call-sound-player';
import { SettingsPage } from '../../settings/primitives';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { NotificationSoundSection } from '../components/NotificationSoundSection';
import { QuietHoursSection } from '../components/QuietHoursSection';
import { playNotificationSound } from '../primitives/sound-player';
import { createNotificationSoundSettings } from '../primitives/sound-settings';
import { useNotificationSounds } from '../use-notification-sounds';

const USER_ID = 'fixture-user';

declare global {
  interface Window {
    deliverNotification: (tag: string) => void;
    playCallCue: (event: 'join' | 'leave') => void;
  }
}

function Fixture() {
  const sounds = createNotificationSoundSettings(USER_ID);
  window.playCallCue = createCallSoundPlayer(() => USER_ID);
  const listeners = new Set<(notification: UnifiedNotification) => void>();
  useNotificationSounds(
    {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    () => USER_ID
  );
  window.deliverNotification = (tag) => {
    // The hook reads only the event tag and lifecycle state.
    const notification = {
      id: crypto.randomUUID(),
      state: 'unseen',
      notification_metadata: { tag },
    } as unknown as UnifiedNotification;
    for (const listener of listeners) listener(notification);
  };

  onMount(() => {
    const dark = new URLSearchParams(location.search).has('dark');
    for (const [key, value] of Object.entries(
      themeCssVars(dark ? macroDarkTheme : macroLightTheme)
    ))
      document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeLight = String(!dark);
  });

  return (
    <main class="h-dvh bg-panel text-ink">
      <SettingsPage title="Notifications">
        <NotificationSoundSection
          settings={sounds.settings()}
          onEnabledChange={sounds.setEnabled}
          onCallSoundsEnabledChange={sounds.setCallSoundsEnabled}
          onVolumeChange={sounds.setVolume}
          onCategoryChange={sounds.setCategory}
          onPreview={(sound) =>
            fireAndForget(
              playNotificationSound(sound, sounds.settings().volume),
              'notification-sounds'
            )
          }
        />
        <QuietHoursSection
          quietHours={sounds.settings().quietHours}
          onChange={sounds.setQuietHours}
        />
      </SettingsPage>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
