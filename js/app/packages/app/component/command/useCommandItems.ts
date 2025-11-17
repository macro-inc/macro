import { useChannelsContext } from '@core/component/ChannelsProvider';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { activeScope } from '@core/hotkey/state';
import { useEmailContacts } from '@core/user';
import { mapFromListsByKey } from '@core/util/compareUtils';
import type { Channel } from '@service-comms/generated/models/channel';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { useHistory } from '@service-storage/history';
import { createMemo } from 'solid-js';
import type { CommandItemCard } from './KonsoleItem';
import { useEntityActionItems } from './useEntityActionItems';

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
  const history = useHistory();
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();
  const contactItems = useEmailContacts();
  // const entityActionItems = useEntityActionItems();
  const entityActionItems = () => [];
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
          hotkeys: command.hotkeys ?? [],
          handler: command.keyDownHandler ?? (() => false),
          activateCommandScopeId: command.activateCommandScopeId,
        },
        updatedAt: 0,
      };
    });

    const items: CommandItemCard[] = history()
      .filter((item) => {
        // Remove the persistent sidebar chats. Those are all called "New Chat"
        // and searching against the name is completely useless.
        if (FILTER_PERSISTENT_CHATS && item.type === 'chat') {
          return !item.isPersistent;
        }
        return true;
      })
      .map((item) => ({
        type: 'item',
        data: {
          id: item.id,
          name: item.name,
          data: item,
          fileType: item.type === 'document' ? item.fileType : undefined,
          itemType: item.type,
        },
        updatedAt: item.updatedAt,
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
          channel.channel_type === 'direct_message'
            ? (channel as any).participants
            : undefined,
      },
      updatedAt: channel.updated_at,
    }));

    const contacts = contactItems().map<CommandItemCard>((contact) => {
      if (contact.type === 'company') {
        return {
          type: 'company',
          data: {
            id: contact.id,
            name: contact.name,
            domain: contact.domain,
          },
          updatedAt: contact.lastInteraction,
        };
      } else {
        return {
          type: 'contact',
          data: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
          },
          updatedAt: contact.lastInteraction,
        };
      }
    });

    const entityActions = entityActionItems();

    return mapFromListsByKey<CommandItemCard>(
      (item) => item.data.id,
      items,
      channels_,
      contacts,
      commands,
      entityActions
    );
  });
}
