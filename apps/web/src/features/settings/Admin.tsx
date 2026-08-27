import { useSoupFilterPersistence } from '@app/features/next-soup/use-soup-filter-persistence';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  clearAllDebugSettings,
  DEBUG_SETTINGS,
  type DebugSettingDef,
  debugSettings,
  getDebugSetting,
  setDebugSetting,
} from '@app/lib/debugSettings';
import {
  ENABLE_SOUP_FILTER_PERSISTENCE_FLAG,
  ENABLE_SOUP_FILTER_PERSISTENCE_OVERRIDE,
} from '@core/constant/featureFlags';
import { Button, ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsRow } from './primitives';

function DebugSettingRow(props: { setting: DebugSettingDef }) {
  const checked = () => getDebugSetting(props.setting.key);

  return (
    <SettingsRow
      label={props.setting.label}
      description={props.setting.description}
    >
      <ToggleSwitch
        size="md"
        checked={checked()}
        onChange={(value) => setDebugSetting(props.setting.key, value)}
      />
    </SettingsRow>
  );
}

export function Admin() {
  const hasActiveSettings = () => Object.keys(debugSettings()).length > 0;
  const soupFilterPersistenceFlag = useFeatureFlag(
    ENABLE_SOUP_FILTER_PERSISTENCE_FLAG,
    { enabledOverride: ENABLE_SOUP_FILTER_PERSISTENCE_OVERRIDE }
  );
  const [shouldPersistSoupFilters, setShouldPersistSoupFilters] =
    useSoupFilterPersistence();

  return (
    <SettingsPage
      title="Debug"
      description="Local toggles for debugging — only visible to Macro staff."
      actions={
        <Button
          variant="outline"
          size="sm"
          depth={3}
          disabled={!hasActiveSettings()}
          onClick={clearAllDebugSettings}
        >
          Reset all
        </Button>
      }
    >
      <Show when={soupFilterPersistenceFlag().enabled}>
        <SettingsCard>
          <SettingsRow
            label="Persist list filters"
            description="Keep soup filters and the last selected tab across reloads on this device."
          >
            <ToggleSwitch
              size="md"
              checked={shouldPersistSoupFilters()}
              onChange={setShouldPersistSoupFilters}
            />
          </SettingsRow>
        </SettingsCard>
      </Show>

      <SettingsCard>
        <For each={DEBUG_SETTINGS}>
          {(setting) => <DebugSettingRow setting={setting} />}
        </For>
      </SettingsCard>
    </SettingsPage>
  );
}
