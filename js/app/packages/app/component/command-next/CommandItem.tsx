import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { Hotkey } from '@core/component/Hotkey';
import { hasValidHotkey } from '@core/hotkey/utils';
import { idToDisplayName } from '@core/user';
import Terminal from '@phosphor-icons/core/regular/terminal.svg?component-solid';
import { createEffect, createMemo, Show } from 'solid-js';
import {
  type QuickAccessItem,
  isEntityItem,
  isUserItem,
  isCommandItem,
} from '@core/context/quickAccess';
import type { ChannelEntity, DocumentEntity } from '@entity';

export interface CommandItemRendererProps {
  item: QuickAccessItem;
  index: number;
  selected: boolean;
  onSelect: (item: QuickAccessItem) => void;
  onMouseEnter: (index: number) => void;
}

/** Get the block name for routing/icon purposes */
function getItemBlockName(item: QuickAccessItem): string | undefined {
  if (!isEntityItem(item)) return undefined;

  const data = item.data;

  switch (data.type) {
    case 'channel':
      return 'channel';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    case 'document': {
      const doc = data as DocumentEntity;
      if (doc.subType?.type === 'task') return 'task';
      if (doc.fileType === 'md') return 'md';
      if (doc.fileType === 'pdf') return 'pdf';
      if (doc.fileType === 'canvas') return 'canvas';
      return doc.fileType ?? 'document';
    }
    default:
      return 'document';
  }
}

/** Render the appropriate icon for a QuickAccess item */
function CommandItemIcon(props: { item: QuickAccessItem }) {
  const icon = createMemo(() => {
    const item = props.item;

    // User items show user avatar
    if (isUserItem(item)) {
      return <UserIcon id={item.data.id} size="sm" isDeleted={false} />;
    }

    // Command items show terminal icon
    if (isCommandItem(item)) {
      return <Terminal class="size-4 text-ink-muted" />;
    }

    // Entity items
    if (isEntityItem(item)) {
      const data = item.data;

      // For DMs, show the first participant's avatar
      if (data.type === 'channel') {
        const channel = data as ChannelEntity;
        if (channel.channelType === 'direct_message') {
          const participantIds = channel.participantIds ?? [];
          const otherId = participantIds[0];
          if (otherId) {
            return <UserIcon id={otherId} size="sm" isDeleted={false} />;
          }
        }
        return (
          <EntityIcon targetType={channel.channelType || 'channel'} size="xs" />
        );
      }

      // Other entities show their appropriate icon
      const blockName = getItemBlockName(item);
      return <EntityIcon targetType={blockName as any} size="xs" />;
    }

    return <EntityIcon targetType="default" size="xs" />;
  });

  return <div class="mr-2 flex-shrink-0">{icon()}</div>;
}

/** Render the item name */
function CommandItemName(props: { item: QuickAccessItem }) {
  const name = createMemo(() => {
    const item = props.item;

    // User items show display name
    if (isUserItem(item)) {
      return idToDisplayName(item.data.id) || item.data.email;
    }

    // Command items show their description
    if (isCommandItem(item)) {
      const desc = item.data.description;
      return typeof desc === 'function' ? desc() : desc;
    }

    // Entity items
    if (isEntityItem(item)) {
      const data = item.data;

      // For DMs, show the display name of the other participant
      if (data.type === 'channel') {
        const channel = data as ChannelEntity;
        if (channel.channelType === 'direct_message') {
          const participantIds = channel.participantIds ?? [];
          const otherId = participantIds[0];
          if (otherId) {
            return idToDisplayName(otherId) || 'Direct Message';
          }
        }
        return channel.name || 'Unnamed Channel';
      }

      return data.name || 'Untitled';
    }

    return 'Untitled';
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
function CommandItemHotkey(props: { item: QuickAccessItem }) {
  const token = createMemo(() => {
    if (!isCommandItem(props.item)) return undefined;
    return props.item.data.hotkeyToken;
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
