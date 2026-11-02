import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@app/features/settings/primitives';
import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableHotkeyProfiles } from '@core/constant/featureFlags';
import CaretUpIcon from '@icon/system/regular/caret-up.svg';
import { Button, ToggleSwitch } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import { HotkeyProfileKeymap } from '../components/hotkey-profile-keymap';
import { useHotkeyProfiles } from '../context/hotkey-profiles-context';
import { HOTKEY_PROFILES, type HotkeyProfile } from '../core/profiles';

function ProfileKeymapDisclosure(props: { profile: HotkeyProfile<string> }) {
  const [open, setOpen] = createSignal(false);
  const contentId = createUniqueId();
  return (
    <div class="px-4 pb-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="-ml-2"
        aria-expanded={open()}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        {open()
          ? t('hotkeyProfiles.hideKeymap')
          : t('hotkeyProfiles.showKeymap')}
        <CaretUpIcon
          class="pointer-events-none size-3.5 shrink-0 transition-transform"
          classList={{ 'rotate-180': open() }}
        />
      </Button>
      <div id={contentId}>
        <CollapseTransition open={open()}>
          <Show when={open()}>
            <div class="pt-3 pb-1">
              <HotkeyProfileKeymap profile={props.profile} />
            </div>
          </Show>
        </CollapseTransition>
      </div>
    </div>
  );
}

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
              <div>
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
                <ProfileKeymapDisclosure profile={profile} />
              </div>
            )}
          </For>
        </SettingsCard>
      </SettingsSection>
    </ShowFeatureFlag>
  );
}
