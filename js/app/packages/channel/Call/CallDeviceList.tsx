import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { MENU_ITEM_CLASS } from '@core/component/Menu';
import CheckIcon from '@icon/bold/check-bold.svg';
import { For, Show } from 'solid-js';
import type { MediaDeviceInfo } from './CallContext';
import { cn } from '@ui/utils/classname';

const deviceRadioRowClass =
  'flex min-w-0 items-center gap-2 w-full py-1 pl-2 pr-2 text-sm font-medium rounded-xs hover:bg-hover hover-transition-bg outline-none focus:bg-active data-[highlighted]:bg-active';

/** Device picker rows for use inside `DropdownMenu` + `DropdownMenuContent` only. */
export function CallDeviceList(props: {
  label: string;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}) {
  return (
    <DropdownMenu.Group class="w-full">
      <DropdownMenu.GroupLabel
        class={`${MENU_ITEM_CLASS} text-xs! text-accent`}
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
              class={cn(deviceRadioRowClass, 'w-full items-baseline')}
            >
              <div class="min-w-0 flex-1">{device.label}</div>
              <span class="inline-flex w-3 shrink-0 justify-center">
                <Show when={props.activeDeviceId === device.deviceId}>
                  <CheckIcon class="h-3 w-3 text-accent" />
                </Show>
              </span>
            </DropdownMenu.RadioItem>
          )}
        </For>
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Group>
  );
}
