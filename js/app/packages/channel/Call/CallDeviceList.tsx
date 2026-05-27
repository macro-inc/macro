import CheckIcon from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type { MediaDeviceInfo } from './CallContext';

/**
 * Device picker rows for use inside a `Dropdown.Group`. Renders a small
 * header label followed by radio rows for each device.
 */
export function CallDeviceList(props: {
  label: string;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <>
      <div class="px-2 pt-0.5 pb-1 text-xs font-medium text-ink-muted">
        {props.label}
      </div>
      <Dropdown.RadioGroup
        value={props.activeDeviceId ?? ''}
        onChange={(value) => props.onSelect(value)}
      >
        <For each={props.devices}>
          {(device) => (
            <Dropdown.RadioItem value={device.deviceId}>
              <span class="min-w-0 flex-1 truncate">{device.label}</span>
              <span class="size-3.5 flex items-center justify-center shrink-0">
                <Show when={props.activeDeviceId === device.deviceId}>
                  <CheckIcon class="size-3 text-accent" />
                </Show>
              </span>
            </Dropdown.RadioItem>
          )}
        </For>
      </Dropdown.RadioGroup>
    </>
  );
}
