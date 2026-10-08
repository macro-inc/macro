import CheckIcon from '@phosphor/check.svg';
import GearIcon from '@phosphor/gear-six.svg';
import { Dropdown } from '@ui';
import { useGantt } from './gantt-context';

function SettingOption(props: { value: string; children: string }) {
  return (
    <Dropdown.RadioItem value={props.value} closeOnSelect={false}>
      <span class="flex-1">{props.children}</span>
      <Dropdown.ItemIndicator>
        <CheckIcon class="size-3.5 text-ink" />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}

/** Period changes zoom; grid settings only change calendar decoration. */
export function GanttSettings() {
  const gantt = useGantt();
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        aria-label="Timeline settings"
        tooltip="Timeline settings"
      >
        <GearIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-60 max-w-[calc(100vw-1rem)]">
        <Dropdown.Group>
          <Dropdown.GroupLabel>Period</Dropdown.GroupLabel>
          <Dropdown.RadioGroup
            value={gantt.scale()}
            onChange={(value) => {
              if (value === 'day' || value === 'week' || value === 'month') {
                gantt.setScale(value);
              }
            }}
          >
            <SettingOption value="day">Day</SettingOption>
            <SettingOption value="week">Week</SettingOption>
            <SettingOption value="month">Month</SettingOption>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.GroupLabel>Grid spacing</Dropdown.GroupLabel>
          <Dropdown.CheckboxItem
            checked={gantt.gridVisible()}
            onChange={gantt.setGridVisible}
            closeOnSelect={false}
          >
            <span class="flex-1">Show grid lines</span>
          </Dropdown.CheckboxItem>
          <Dropdown.RadioGroup
            value={gantt.gridScale()}
            onChange={(value) => {
              if (value === 'day' || value === 'week' || value === 'month') {
                gantt.setGridScale(value);
              }
            }}
          >
            <SettingOption value="day">Daily</SettingOption>
            <SettingOption value="week">Weekly</SettingOption>
            <SettingOption value="month">Monthly</SettingOption>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.GroupLabel>Line style</Dropdown.GroupLabel>
          <Dropdown.RadioGroup
            value={gantt.gridStyle()}
            onChange={(value) => {
              if (value === 'solid' || value === 'dashed') {
                gantt.setGridStyle(value);
              }
            }}
          >
            <SettingOption value="solid">Solid</SettingOption>
            <SettingOption value="dashed">Dashed</SettingOption>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
