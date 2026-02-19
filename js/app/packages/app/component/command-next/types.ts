import type { DateValue } from '@core/util/date';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import type { BasicDocumentFileType } from '@service-storage/generated/schemas/basicDocumentFileType';
import type { BasicDocumentSubTypeProperty } from '@service-storage/generated/schemas';
import type { HistoryItem } from '@queries/history/history';

/** Base data that all command items share */
export interface CommandItemBase {
  id: string;
  name: string;
}

/** A history item (document, chat, project) */
export interface HistoryItemData extends CommandItemBase {
  historyItem: HistoryItem;
  fileType?: BasicDocumentFileType;
  subType?: BasicDocumentSubTypeProperty;
}

/** A channel item */
export interface ChannelItemData extends CommandItemBase {
  channelType: ChannelType;
  participants?: ChannelParticipant[];
  updatedAt?: DateValue;
}

/** A command/action item */
export interface CommandActionData extends CommandItemBase {
  command: CommandWithInfo;
}

/** Union of all command item types */
export type CommandItem =
  | { type: 'history'; data: HistoryItemData }
  | { type: 'channel'; data: ChannelItemData }
  | { type: 'command'; data: CommandActionData };

/** Get the ID from any command item */
export function getCommandItemId(item: CommandItem): string {
  return item.data.id;
}

/** Get the name from any command item */
export function getCommandItemName(item: CommandItem): string {
  return item.data.name;
}

/** Get the timestamp for sorting */
export function getCommandItemTimestamp(item: CommandItem): {
  updatedAt?: DateValue | null;
  viewedAt?: DateValue | null;
} {
  switch (item.type) {
    case 'history':
      return {
        updatedAt: item.data.historyItem.updatedAt,
        viewedAt: item.data.historyItem.viewedAt,
      };
    case 'channel':
      return {
        updatedAt: item.data.updatedAt,
      };
    case 'command':
      return {};
  }
}

/** Category filter options */
export type CategoryFilter =
  | 'all'
  | 'documents'
  | 'channels'
  | 'chats'
  | 'commands';

export interface CategoryOption {
  id: CategoryFilter;
  label: string;
}

export const CATEGORY_OPTIONS: CategoryOption[] = [
  { id: 'all', label: 'Everything' },
  { id: 'documents', label: 'Documents' },
  { id: 'channels', label: 'Channels' },
  { id: 'chats', label: 'Chats' },
  { id: 'commands', label: 'Commands' },
];
