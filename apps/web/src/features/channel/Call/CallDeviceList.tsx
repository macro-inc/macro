import { Dropdown, SingleSelectCheck } from '@ui';
import { For } from 'solid-js';
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
            <Dropdown.RadioItem closeOnSelect={false} value={device.deviceId}>
              <span class="min-w-0 flex-1 truncate">{device.label}</span>
              <SingleSelectCheck
                active={props.activeDeviceId === device.deviceId}
              />
            </Dropdown.RadioItem>
          )}
        </For>
      </Dropdown.RadioGroup>
    </>
  );
}
