import CheckIcon from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type { MediaDeviceInfo } from './CallContext';

/** Device picker rows for use inside `Dropdown` + `Dropdown.Content` only. */
export function CallDeviceList(props: {
  label: string;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <Dropdown.Group>
      <Dropdown.GroupLabel>{props.label}</Dropdown.GroupLabel>
      <Dropdown.RadioGroup
        value={props.activeDeviceId ?? ''}
        onChange={(value) => props.onSelect(value)}
      >
        <For each={props.devices}>
          {(device) => (
            <Dropdown.RadioItem value={device.deviceId}>
              <span class="flex-1 truncate">{device.label}</span>
              <span class="inline-flex w-3 shrink-0 justify-center">
                <Show when={props.activeDeviceId === device.deviceId}>
                  <CheckIcon class="size-3 text-accent" />
                </Show>
              </span>
            </Dropdown.RadioItem>
          )}
        </For>
      </Dropdown.RadioGroup>
    </Dropdown.Group>
  );
}
