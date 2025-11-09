import Alien from '@icon/regular/alien.svg';
import Users from '@icon/regular/users.svg';

const UsersIcon = import.meta.hot ? Alien : Users;

import type { BlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import { blockAcceptsFileExtension } from '@core/constant/allBlocks';
import clickOutside from '@core/directive/clickOutside';
import type { SortPair } from '@core/util/sort';
import FilterIcon from '@icon/regular/funnel-simple.svg';
import FilterClearIcon from '@icon/regular/funnel-simple-x.svg';
import UserIcon from '@icon/regular/user.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { Item } from '@service-storage/generated/schemas/item';
import {
  createSelector,
  createSignal,
  For,
  type JSXElement,
  type Setter,
  Show,
} from 'solid-js';
import {
  DropdownMenuContent,
  GroupLabel,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '../Menu';

false && clickOutside;

export function matcheOwnershipFilters(
  item: Item,
  userId: string,
  ownershipFilters: OwnershipFilter[]
) {
  if (ownershipFilters.length !== 1) return true;

  if (ownershipFilters[0] === 'User') {
    switch (item.type) {
      case 'document':
        return item.owner === userId;
      case 'chat':
      case 'project':
        return item.userId === userId;
    }
  } else if (ownershipFilters[0] === 'Others') {
    switch (item.type) {
      case 'document':
        return item.owner !== userId;
      case 'chat':
      case 'project':
        return item.userId !== userId;
    }
  }

  return false;
}

export function matchesActiveFilters(
  item: Item,
  activeFilters: ItemFilter[],
  userId?: string,
  ownershipFilters?: OwnershipFilter[]
) {
  if (
    userId &&
    ownershipFilters &&
    !matcheOwnershipFilters(item, userId, ownershipFilters)
  )
    return false;

  if (activeFilters.length === 0) return true;
  if (item.type === 'document') {
    const fileType = item.fileType?.toLowerCase();
    return activeFilters.some((filter) => {
      if (filter === 'PDF') return fileType === 'pdf';
      if (filter === 'DOCX') return fileType === 'docx';
      if (filter === 'Note') return fileType === 'md';
      if (filter === 'Canvas') return fileType === 'canvas';
      if (filter === 'Image')
        return (
          fileType &&
          ['jpg', 'png', 'gif', 'bmp', 'tiff', 'webp'].includes(fileType)
        );
      if (filter === 'Video')
        return (
          fileType &&
          [
            'mp4',
            'mkv',
            'webm',
            'avi',
            'mov',
            'wmv',
            'mpg',
            'mpeg',
            'm4v',
            'flv',
            'f4v',
            'threegp',
          ].includes(fileType)
        );
      if (fileType && filter === 'Code')
        return blockAcceptsFileExtension('code', fileType);
      return false;
    });
  }
  if (item.type === 'chat') {
    return activeFilters.includes('Chat');
  }
  if (item.type === 'project') {
    return activeFilters.includes('Project');
  }
  return false;
}

export const FILE_TYPE_FILTERS = [
  'PDF',
  'DOCX',
  'Chat',
  'Note',
  'Image',
  'Video',
  'Canvas',
  'Code',
  'Project',
] as const;

export type ItemFilter = (typeof FILE_TYPE_FILTERS)[number];

export const getItemFilterBlockName = (filter: ItemFilter): BlockName => {
  switch (filter) {
    case 'PDF':
      return 'pdf';
    case 'DOCX':
      return 'write';
    case 'Chat':
      return 'chat';
    case 'Note':
      return 'md';
    case 'Image':
      return 'image';
    case 'Video':
      return 'video';
    case 'Canvas':
      return 'canvas';
    case 'Code':
      return 'code';
    case 'Project':
      return 'project';
  }
};

export type OwnershipFilter = 'User' | 'Others';

export function FilterContainer(props: {
  children: JSXElement;
  hasFilters?: boolean;
  clear?: () => void;
}) {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <DropdownMenu open={isOpen()} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger class="flex items-center justify-end align-middle gap-2 px-1">
        <IconButton
          theme={'clear'}
          icon={FilterIcon}
          class={`${props.hasFilters ? 'text-accent-ink!' : ''} ${isOpen() ? 'bg-active!' : ''}`}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <Show when={props.clear}>
          <MenuItem
            text="Reset To Default"
            icon={FilterClearIcon}
            onClick={() => props.clear?.()}
          />
          <MenuSeparator />
        </Show>
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CHANNEL_TYPE_FILTERS: string[] = [
  'public',
  'organization',
  'private',
  'direct_message',
] as const;

const CHANNEL_TYPE_DISPLAY_NAMES: Record<string, string> = {
  public: 'Public',
  organization: 'Organization',
  private: 'Private',
  direct_message: 'Direct Message',
};

type ChannelTypeFilterProps = {
  activeFilters: string[];
  setActiveFilters: (filters: string[]) => void;
};

export function ChannelTypeFilter(props: ChannelTypeFilterProps) {
  function isChannelTypeSelected(fileType: string) {
    if (props.activeFilters.includes(fileType)) return true;
    return false;
  }

  function selectChannelType(fileType: string) {
    let newFilters = props.activeFilters;
    if (isChannelTypeSelected(fileType)) {
      newFilters = newFilters.filter((f) => f !== fileType);
    } else {
      newFilters = [...newFilters, fileType];
    }

    props.setActiveFilters(newFilters);
  }

  return (
    <MenuGroup>
      <GroupLabel> Filter </GroupLabel>
      <For each={CHANNEL_TYPE_FILTERS}>
        {(type) => {
          return (
            <MenuItem
              text={CHANNEL_TYPE_DISPLAY_NAMES[type]}
              checked={isChannelTypeSelected(type)}
              selectorType="checkbox"
              onClick={() => {
                selectChannelType(type);
              }}
            />
          );
        }}
      </For>
    </MenuGroup>
  );
}

type FileTypeFilterProps = {
  activeFilters: ItemFilter[];
  setActiveFilters: (filters: ItemFilter[]) => void;
};

/** supports filtering by file type */
export function FileTypeFilter(props: FileTypeFilterProps) {
  function isFileTypeSelected(fileType: ItemFilter) {
    return props.activeFilters.includes(fileType);
  }

  function selectFileType(fileType: ItemFilter) {
    let newFilters = props.activeFilters;
    if (isFileTypeSelected(fileType)) {
      newFilters = newFilters.filter((f) => f !== fileType);
    } else {
      newFilters = [...newFilters, fileType];
    }

    props.setActiveFilters(newFilters);
  }

  return (
    <MenuGroup>
      <GroupLabel> Filter </GroupLabel>
      <For each={FILE_TYPE_FILTERS}>
        {(fileType) => {
          return (
            <MenuItem
              text={fileType}
              checked={isFileTypeSelected(fileType)}
              selectorType="checkbox"
              icon={
                <EntityIcon
                  targetType={getItemFilterBlockName(fileType)}
                  size="xs"
                />
              }
              onClick={() => {
                selectFileType(fileType);
              }}
            />
          );
        }}
      </For>
    </MenuGroup>
  );
}

type FileSortFilterProps = {
  labels: Map<SortPair, string>;
  currentPair: SortPair;
  handlePairSelect: (pair: SortPair) => void;
};

/** Sorting of the files */
export function FileSortFilter(props: FileSortFilterProps) {
  return (
    <MenuGroup>
      <GroupLabel> Sort </GroupLabel>
      <DropdownMenu.RadioGroup value={props.currentPair}>
        <For each={[...props.labels.entries()]}>
          {([sortPair, label]) => (
            <MenuItem
              value={sortPair[0]}
              text={label}
              groupValue={props.currentPair[0]}
              selectorType="radio"
              onClick={() => {
                props.handlePairSelect(sortPair);
              }}
            />
          )}
        </For>
      </DropdownMenu.RadioGroup>
    </MenuGroup>
  );
}

type AdditionalOptionsProps = {
  projectsFirst?: boolean;
  setProjectsFirst?: Setter<boolean>;
  showTrash?: boolean;
  setShowTrash?: Setter<boolean>;
};

export function AdditionalOptions(props: AdditionalOptionsProps) {
  return (
    <Show
      when={props.projectsFirst !== undefined || props.showTrash !== undefined}
    >
      <MenuGroup>
        <MenuSeparator />
        <GroupLabel> Options </GroupLabel>
        <Show when={props.projectsFirst !== undefined}>
          <MenuItem
            text="Show folders first"
            checked={props.projectsFirst ?? false}
            selectorType="checkbox"
            onClick={() => props.setProjectsFirst?.((prev) => !prev)}
          />
        </Show>
        <Show when={props.showTrash !== undefined}>
          <MenuItem
            text="Show trash"
            checked={props.showTrash ?? false}
            selectorType="checkbox"
            onClick={() => props.setShowTrash?.((prev) => !prev)}
          />
        </Show>
      </MenuGroup>
    </Show>
  );
}

type OwnershipFilterProps = {
  ownershipFilters: OwnershipFilter[];
  setOwnershipFilters: Setter<OwnershipFilter[]>;
};
/** supports filtering by ownership */
export function ItemOwnershipFilter(props: OwnershipFilterProps) {
  const isSelected = createSelector(
    () => props.ownershipFilters,
    (filter: OwnershipFilter, ownershipFilters) =>
      ownershipFilters.includes(filter)
  );

  const toggleFilter = (filter: OwnershipFilter) => {
    if (isSelected(filter)) {
      props.setOwnershipFilters((prev) => prev.filter((f) => f !== filter));
    } else {
      props.setOwnershipFilters((prev) => [...prev, filter]);
    }
  };

  return (
    <MenuGroup>
      <GroupLabel> Owned by </GroupLabel>
      <MenuItem
        text="Me"
        checked={isSelected('User')}
        selectorType="checkbox"
        icon={UserIcon}
        onClick={() => toggleFilter('User')}
      />
      <MenuItem
        text="Others"
        checked={isSelected('Others')}
        selectorType="checkbox"
        icon={UsersIcon}
        onClick={() => toggleFilter('Others')}
      />
    </MenuGroup>
  );
}
