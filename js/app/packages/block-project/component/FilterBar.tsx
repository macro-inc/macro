import {
  FileTypeFilter,
  type ItemFilter,
  ItemOwnershipFilter,
  type OwnershipFilter,
} from '@core/component/FileList/Filter';
import { DropdownMenuContent } from '@core/component/Menu';
import { TextButton } from '@core/component/TextButton';
import SearchIcon from '@icon/regular/magnifying-glass.svg?component-solid';

import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { type Setter, Show } from 'solid-js';

interface FilterBarProps {
  activeFilters: ItemFilter[];
  setActiveFilters: (filters: ItemFilter[]) => void;
  ownershipFilters: OwnershipFilter[];
  setOwnershipFilters: Setter<OwnershipFilter[]>;
  fileSearchQuery: string;
  setFileSearchQuery: Setter<string>;
  parentName: string;
}

export function FilterBar(props: FilterBarProps) {
  return (
    <div class="w-full flex flex-row items-center gap-2 px-2 py-2">
      <div class="flex flex-row items-center gap-2">
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <TextButton
              text="Type"
              theme={props.activeFilters.length > 0 ? 'accent' : 'base'}
              showChevron
              tabIndex={-1}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <FileTypeFilter
                activeFilters={props.activeFilters}
                setActiveFilters={props.setActiveFilters}
              />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <TextButton
              text="Owner"
              theme={props.ownershipFilters.length > 0 ? 'accent' : 'base'}
              showChevron
              tabIndex={-1}
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <ItemOwnershipFilter
                ownershipFilters={props.ownershipFilters}
                setOwnershipFilters={props.setOwnershipFilters}
              />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <Show
          when={
            props.activeFilters.length > 0 || props.ownershipFilters.length > 0
          }
        >
          <TextButton
            text="Clear filters"
            theme="clear"
            onClick={() => {
              props.setActiveFilters([]);
              props.setOwnershipFilters([]);
            }}
          />
        </Show>
      </div>
      <div class="flex-1 flex flex-row items-center pl-2">
        <SearchIcon class="w-4 h-4 shrink-0" />
        <input
          value={props.fileSearchQuery}
          type="text"
          placeholder={`Search in ${props.parentName}...`}
          onInput={(e) => {
            props.setFileSearchQuery(e.currentTarget.value);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          class="w-full p-3 pr-0 outline-none! ring-0! border-0 text-sm focus:outline-none focus:ring-0 text-ink truncate"
        />
      </div>
    </div>
  );
}
