import { useChannelsContext } from '@core/context/channels';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { activeScope } from '@core/hotkey/state';
import { mapFromListsByKey } from '@core/util/compareUtils';
import { useHistoryQuery } from '@queries/history/history';
import type { Channel } from '@service-comms/generated/models/channel';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { ChannelTypeEnum } from '@service-comms/client';
import { createMemo } from 'solid-js';
import type { CommandItemCard } from './KonsoleItem';

type ChannelWithViewedAt = Channel & { viewed_at?: number };

const FILTER_PERSISTENT_CHATS = false;

function channelsIntoCategories(channels: Channel[]) {
  const bins: Record<ChannelType, Channel[]> = {
    public: [],
    organization: [],
    direct_message: [],
    private: [],
  };

  for (const chan of channels) {
    bins[chan.channel_type].push(chan);
  }

  return bins;
}

export function useCommandItems() {
  const historyQuery = useHistoryQuery();
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;
  const activeCommands = getActiveCommandsFromScope(activeScope(), {
    sortByScopeLevel: false,
    hideShadowedCommands: false,
    hideCommandsWithoutHotkeys: false,
  });

  return createMemo<Map<string, CommandItemCard>>(() => {
    const commands: CommandItemCard[] = activeCommands.map((command) => {
      const description =
        typeof command.description === 'function'
          ? command.description()
          : command.description;
      return {
        type: 'command' as const,
        data: {
          id: description.replaceAll(' ', '-'),
          name: description,
          command: command,
        },
        updatedAt: 0,
      };
    });

    const historyData = historyQuery.data ?? [];
    const items: CommandItemCard[] = historyData
      .filter((item) => {
        // Remove the persistent sidebar chats. Those are all called "New Chat"
        // and searching against the name is completely useless.
        if (FILTER_PERSISTENT_CHATS && item.type === 'chat') {
          return !item.isPersistent;
        }
        if (item.deletedAt) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        type: 'item',
        data: {
          id: item.id,
          name: item.name,
          data: item,
          itemType: item.type,
          fileType: item.type === 'document' ? item.fileType : undefined,
          subType: item.type === 'document' ? item.subType : undefined,
        },
        updatedAt: item.updatedAt,
        viewedAt: item.viewedAt,
      }));
    const bins = channelsIntoCategories(channels());
    const channels_: CommandItemCard[] = [
      ...bins.direct_message,
      ...bins.private,
      ...bins.organization,
      ...bins.public,
    ].map((channel) => ({
      type: 'channel',
      data: {
        id: channel.id,
        name: channel.name!,
        channel_type: channel.channel_type,
        participants:
          channel.channel_type === ChannelTypeEnum.DirectMessage
            ? (channel as any).participants
            : undefined,
      },
      updatedAt: channel.updated_at,
      viewedAt: (channel as ChannelWithViewedAt).viewed_at,
    }));

    return mapFromListsByKey<CommandItemCard>(
      (item) => item.data.id,
      items,
      channels_,
      commands
    );
  });
}
