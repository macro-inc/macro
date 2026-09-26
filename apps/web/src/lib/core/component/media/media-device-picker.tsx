import CaretDown from '@phosphor/caret-down.svg';
import { Dropdown, SingleSelectCheck, Tooltip } from '@ui';
import { For, type JSX } from 'solid-js';

export function MediaDevicePicker(props: {
  label: string;
  icon: JSX.Element;
  devices: ReadonlyArray<Pick<MediaDeviceInfo, 'deviceId' | 'label'>>;
  selected: string;
  placement?: 'top-start' | 'bottom-start' | 'top-end' | 'bottom-end';
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  unsupported?: boolean;
  onSelect: (id: string) => void;
}) {
  const selectedLabel = () =>
    props.devices.find((device) => device.deviceId === props.selected)?.label ||
    'System default';
  return (
    <Dropdown
      placement={props.placement ?? 'bottom-start'}
      onOpenChange={props.onOpenChange}
    >
      <Tooltip
        placement="top"
        label={
          props.unsupported
            ? 'Your browser uses the system’s speaker selection'
            : `${props.label}: ${selectedLabel()}`
        }
        class="w-full min-w-0"
      >
        <Dropdown.Trigger
          disabled={props.disabled || props.unsupported}
          aria-label={`${props.label}: ${selectedLabel()}`}
          size="lg"
          fullWidth
          class="min-w-0 text-sm"
        >
          {props.icon}
          <span class="min-w-0 flex-1 truncate text-left">
            {selectedLabel()}
          </span>
          <CaretDown class="size-3 shrink-0" />
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content class="max-w-80">
        <div class="px-2 py-1 text-xs font-medium text-ink-muted">
          {props.label}
        </div>
        <Dropdown.RadioGroup value={props.selected} onChange={props.onSelect}>
          <Dropdown.RadioItem closeOnSelect value="">
            <span class="flex-1">System default</span>
            <SingleSelectCheck active={!props.selected} />
          </Dropdown.RadioItem>
          <For each={props.devices.filter((device) => device.deviceId !== '')}>
            {(device, index) => (
              <Dropdown.RadioItem closeOnSelect value={device.deviceId}>
                <span class="min-w-0 flex-1 truncate">
                  {device.label || `${props.label} ${index() + 1}`}
                </span>
                <SingleSelectCheck
                  active={props.selected === device.deviceId}
                />
              </Dropdown.RadioItem>
            )}
          </For>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
