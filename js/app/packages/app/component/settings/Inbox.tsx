import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { For } from 'solid-js';
import {
  DEPRIORITY_LABEL_SIGNAL_TOGGLES,
  DEPRIORITY_METADATA_SIGNAL_TOGGLES,
  PRIORITY_LABEL_SIGNAL_TOGGLES,
  PRIORITY_METADATA_SIGNAL_TOGGLES,
} from '../soupFilters';

export function Inbox() {
  const prioritySignals = [
    ...PRIORITY_LABEL_SIGNAL_TOGGLES,
    ...PRIORITY_METADATA_SIGNAL_TOGGLES,
  ];
  const deprioritySignals = [
    ...DEPRIORITY_LABEL_SIGNAL_TOGGLES,
    ...DEPRIORITY_METADATA_SIGNAL_TOGGLES,
  ];

  return (
      <div class="font-mono flex flex-col gap-3 text-sm p-2">
        <div class="border border-[var(--b4)] box-border px-5 py-3 flex flex-col gap-3">
          <div class="font-bold mb-1">Signal</div>
          <For each={prioritySignals}>
            {(signal) => (
              <div class="flex items-center justify-between">
                <span>{signal.label}</span>
                <ToggleSwitch
                  checked={signal.enabled()}
                  onChange={(enabled) => signal.setEnabled(enabled)}
                />
              </div>
            )}
          </For>
        </div>

        <div class="border border-[var(--b4)] box-border px-5 py-3 flex flex-col gap-3">
          <div class="font-bold mb-1">Noise</div>
          <For each={deprioritySignals}>
            {(signal) => (
              <div class="flex items-center justify-between">
                <span>{signal.label}</span>
                <ToggleSwitch
                  checked={signal.enabled()}
                  onChange={(enabled) => signal.setEnabled(enabled)}
                />
              </div>
            )}
          </For>
        </div>
      </div>
  );
}

