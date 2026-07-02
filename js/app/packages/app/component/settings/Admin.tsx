import { For } from 'solid-js';
import { Button, ToggleSwitch } from '@ui';
import {
  type DebugSettingDef,
  DEBUG_SETTINGS,
  clearAllDebugSettings,
  debugSettings,
  getDebugSetting,
  setDebugSetting,
} from '@app/lib/debugSettings';
import { SettingsCard, SettingsPage, SettingsRow } from './primitives';

function DebugSettingRow(props: { setting: DebugSettingDef }) {
  const checked = () => getDebugSetting(props.setting.key);

  return (
    <SettingsRow label={props.setting.label} description={props.setting.description}>
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

  return (
    <SettingsPage
      title="Debug"
      description="Local toggles for debugging — only visible to Macro staff."
      actions={
        <Button
          variant="base"
          size="sm"
          depth={3}
          disabled={!hasActiveSettings()}
          onClick={clearAllDebugSettings}
        >
          Reset all
        </Button>
      }
    >
      <SettingsCard>
        <For each={DEBUG_SETTINGS}>
          {(setting) => <DebugSettingRow setting={setting} />}
        </For>
      </SettingsCard>
    </SettingsPage>
  );
}
