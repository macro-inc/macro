import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableHotkeyProfiles } from '@core/constant/featureFlags';
import { ToggleSwitch } from '@ui';
import { For } from 'solid-js';
import { HotkeyProfileKeymap } from '../components/hotkey-profile-keymap';
import { useHotkeyProfiles } from '../context/hotkey-profiles-context';
import { HOTKEY_PROFILES } from '../core/profiles';

/** Settings → Keyboard shortcuts: turn another app's keys on in its view. */
export function HotkeyProfilesSettings() {
  const profiles = useHotkeyProfiles();
  return (
    <ShowFeatureFlag flag={enableHotkeyProfiles}>
      <SettingsSection
        title={t('hotkeyProfiles.sectionTitle')}
        description={t('hotkeyProfiles.sectionDescription')}
        target="Shortcut profiles"
      >
        <SettingsCard>
          <For each={HOTKEY_PROFILES}>
            {(profile) => (
              <div class="flex flex-col gap-2">
                <SettingsRow
                  label={profile.toggleLabel()}
                  description={profile.toggleDescription()}
                >
                  <ToggleSwitch
                    size="md"
                    aria-label={profile.toggleLabel()}
                    disabled={!profiles.ready()}
                    checked={
                      profiles.activeProfile(profile.domain) === profile.id
                    }
                    onChange={(checked) =>
                      profiles.setProfile(
                        profile.domain,
                        checked ? profile.id : undefined
                      )
                    }
                  />
                </SettingsRow>
                <details class="pb-3">
                  <summary class="text-sm text-ink-muted">
                    {t('hotkeyProfiles.showKeymap')}
                  </summary>
                  <div class="pt-3">
                    <HotkeyProfileKeymap profile={profile} />
                  </div>
                </details>
              </div>
            )}
          </For>
        </SettingsCard>
      </SettingsSection>
    </ShowFeatureFlag>
  );
}
