import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { MENU_ITEM_CLASS } from '@core/component/Menu';
import CheckIcon from '@icon/bold/check-bold.svg';
import { For, Show } from 'solid-js';
import type { MediaDeviceInfo } from './CallContext';

const deviceRadioRowClass =
  'flex items-center gap-2 w-full py-1 pl-2 pr-2 text-sm font-medium rounded-xs cursor-pointer hover:bg-hover hover-transition-bg focus-bracket';

/** Device picker rows for use inside `DropdownMenu` + `DropdownMenuContent` only. */
export function CallDeviceList(props: {
  label: string;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <DropdownMenu.Group>
      <DropdownMenu.GroupLabel
        class={`${MENU_ITEM_CLASS} text-xs! text-ink-extra-muted`}
      >
        {props.label}
      </DropdownMenu.GroupLabel>
      <DropdownMenu.RadioGroup
        value={props.activeDeviceId ?? ''}
        onChange={(value) => props.onSelect(value)}
      >
        <For each={props.devices}>
          {(device) => (
            <DropdownMenu.RadioItem
              value={device.deviceId}
              class={deviceRadioRowClass}
            >
              <div class="flex-1 truncate">{device.label}</div>
              <Show when={props.activeDeviceId === device.deviceId}>
                <CheckIcon class="w-3 h-3 shrink-0 text-accent" />
              </Show>
            </DropdownMenu.RadioItem>
          )}
        </For>
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Group>
  );
}
