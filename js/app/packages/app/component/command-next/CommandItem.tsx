import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { Hotkey } from '@core/component/Hotkey';
import { itemToBlockName } from '@core/constant/allBlocks';
import { hasValidHotkey } from '@core/hotkey/utils';
import { idToDisplayName } from '@core/user';
import Terminal from '@phosphor-icons/core/regular/terminal.svg?component-solid';
import { ChannelTypeEnum } from '@service-comms/client';
import { createEffect, createMemo, Show } from 'solid-js';
import type { CommandItem } from './types';

export interface CommandItemRendererProps {
  item: CommandItem;
  index: number;
  selected: boolean;
  onSelect: (item: CommandItem) => void;
  onMouseEnter: (index: number) => void;
}

/** Get the block name for routing/icon purposes */
function getItemBlockName(item: CommandItem, forIcon = false) {
  if (item.type === 'history') {
    return itemToBlockName(
      {
        ...item.data.historyItem,
        type: item.data.historyItem.type,
      },
      forIcon
    );
  }
  if (item.type === 'channel') {
    return 'channel';
  }
  return undefined;
}

/** Render the appropriate icon for a command item */
function CommandItemIcon(props: { item: CommandItem }) {
  const icon = createMemo(() => {
    const item = props.item;

    switch (item.type) {
      case 'history': {
        const blockName = getItemBlockName(item, true);
        return <EntityIcon targetType={blockName} size="xs" />;
      }

      case 'channel': {
        // For DMs, show the other participant's avatar
        if (item.data.channelType === ChannelTypeEnum.DirectMessage) {
          const participants = item.data.participants ?? [];
          // Find the first participant (ideally we'd filter out current user)
          const other = participants[0];
          if (other) {
            return <UserIcon id={other.user_id} size="sm" isDeleted={false} />;
          }
        }
        return (
          <EntityIcon
            targetType={item.data.channelType || 'channel'}
            size="xs"
          />
        );
      }

      case 'command': {
        return <Terminal class="size-4 text-ink-muted" />;
      }
    }
  });

  return <div class="mr-2 flex-shrink-0">{icon()}</div>;
}

/** Render the item name */
function CommandItemName(props: { item: CommandItem }) {
  const name = createMemo(() => {
    const item = props.item;

    if (item.type === 'channel') {
      // For DMs, show the display name of the other participant
      if (item.data.channelType === ChannelTypeEnum.DirectMessage) {
        const participants = item.data.participants ?? [];
        const other = participants[0];
        if (other) {
          // idToDisplayName takes user_id
          return idToDisplayName(other.user_id);
        }
      }
      return item.data.name || 'Unnamed Channel';
    }

    return item.data.name || 'Untitled';
  });

  return (
    <span
      class="text-ink text-sm font-medium grow overflow-hidden text-nowrap"
      style={{ 'text-overflow': 'ellipsis' }}
    >
      {name()}
    </span>
  );
}

/** Render hotkey hint for commands */
function CommandItemHotkey(props: { item: CommandItem }) {
  const token = createMemo(() => {
    if (props.item.type !== 'command') return undefined;
    return props.item.data.command.hotkeyToken;
  });

  const validToken = createMemo(() => hasValidHotkey(token()));

  return (
    <Show when={validToken()}>
      <div class="pr-2 flex items-center justify-center text-[0.75rem] font-medium text-ink-extra-muted">
        <div class="p-2 py-0.5 border border-edge-muted/50 rounded-xs">
          <Hotkey token={token()} class="flex gap-1 items-center" />
        </div>
      </div>
    </Show>
  );
}

/** Main command item renderer */
export function CommandItemRenderer(props: CommandItemRendererProps) {
  let itemRef: HTMLDivElement | undefined;

  // Scroll selected item into view
  createEffect(() => {
    if (props.selected && itemRef) {
      itemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  return (
    <div
      ref={itemRef}
      class="group flex items-center px-3 py-2 mx-1 my-0.5 rounded cursor-pointer"
      classList={{
        'bg-active': props.selected,
      }}
      onMouseEnter={() => props.onMouseEnter(props.index)}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onSelect(props.item);
      }}
    >
      <CommandItemIcon item={props.item} />
      <CommandItemName item={props.item} />
      <CommandItemHotkey item={props.item} />
    </div>
  );
}
