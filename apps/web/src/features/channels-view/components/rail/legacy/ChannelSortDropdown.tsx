import { ViewSidebar } from '@app/components/view-shell';
import CheckIcon from '@icon/system/regular/check.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import type { ChannelListSort, ChannelsSortGroup } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';

const CHANNEL_SORT_OPTIONS: {
  value: ChannelListSort;
  label: string;
}[] = [
  { value: 'viewed_at', label: 'Last viewed' },
  { value: 'updated_at', label: 'Last updated' },
  { value: 'created_at', label: 'Date created' },
];

export function ChannelSortDropdown(props: {
  group: ChannelsSortGroup;
  label: string;
}) {
  const rail = useChannelsRail();
  const setSort = (value: string) => {
    const option = CHANNEL_SORT_OPTIONS.find((item) => item.value === value);
    if (option) rail.setSortBy(props.group, option.value);
  };

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        aria-label={`Sort ${props.label.toLowerCase()}`}
        tooltip={`Sort ${props.label.toLowerCase()}`}
        as={ViewSidebar.Control}
        variant="ghost"
        size="icon-sm"
      >
        <SortIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-40">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={rail.sortBy(props.group)}
            onChange={setSort}
          >
            <For each={CHANNEL_SORT_OPTIONS}>
              {(option) => (
                <Dropdown.RadioItem closeOnSelect value={option.value}>
                  <span class="flex-1">{option.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
