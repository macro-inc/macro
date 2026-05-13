import { monochromeIcons, setMonochromeIcons, setTooltipsEnabled, tooltipsEnabled } from '@ui/signals/signals';
import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';

export function UI() {
  return (
    <div class="grid gap-px bg-edge-muted border-b border-edge-muted">
      <div class="bg-surface flex items-center justify-between h-15.25 px-6">
        <div class="text-sm">Show tooltips</div>
        <ToggleSwitch
          onChange={setTooltipsEnabled}
          checked={tooltipsEnabled()}
          falseLabel="Off"
          trueLabel="On"
          size="SM"
        />
      </div>

      <div class="bg-surface flex items-center justify-between h-15.25 px-6">
        <div class="text-sm">Monochrome icons</div>
        <ToggleSwitch
          onChange={setMonochromeIcons}
          checked={monochromeIcons()}
          falseLabel="Off"
          trueLabel="On"
          size="SM"
        />
      </div>
    </div>
  );
}
