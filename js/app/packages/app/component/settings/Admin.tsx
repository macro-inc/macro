import { For } from 'solid-js';
import { Button, Panel, ToggleSwitch } from '@ui';
import {
  type DebugSettingDef,
  DEBUG_SETTINGS,
  clearAllDebugSettings,
  debugSettings,
  getDebugSetting,
  setDebugSetting,
} from '@app/lib/debugSettings';

function DebugSettingRow(props: { setting: DebugSettingDef }) {
  const checked = () => getDebugSetting(props.setting.key);

  return (
    <div class="flex items-center justify-between gap-4 py-2 px-6">
      <div class="min-w-0">
        <div class="text-sm">{props.setting.label}</div>
        <div class="text-xs text-ink-extra-muted">
          {props.setting.description}
        </div>
      </div>
      <ToggleSwitch
        checked={checked()}
        onChange={(value) => setDebugSetting(props.setting.key, value)}
      />
    </div>
  );
}

export function Admin() {
  const hasActiveSettings = () => Object.keys(debugSettings()).length > 0;

  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        <Panel depth={2}>
          <Panel.Header>
            <div class="flex items-center justify-between gap-4 w-full px-2 py-2">
              <div>
                <div class="text-sm font-medium">Debug settings</div>
                <div class="text-xs text-ink-extra-muted">
                  Local toggles for debugging — only visible to Macro staff.
                </div>
              </div>
              <Button
                variant="base"
                size="sm"
                disabled={!hasActiveSettings()}
                onClick={clearAllDebugSettings}
              >
                Reset all
              </Button>
            </div>
          </Panel.Header>

          <Panel.Body scroll>
            <div class="flex flex-col py-2">
              <For each={DEBUG_SETTINGS}>
                {(setting) => <DebugSettingRow setting={setting} />}
              </For>
            </div>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
