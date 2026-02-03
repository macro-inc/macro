import { createAssertedContextProvider } from '@core/context/createContext';
import { useChannelQuery } from '@queries/channel/channel';
import {
  getThreadMessages,
  getTopLevelMessages,
} from '@queries/channel/derived';
import type {
  Attachment,
  ChannelType,
  GetChannelResponse,
  GetChannelResponseReactions,
} from '@service-comms/generated/models';
import type { Message } from '@service-comms/generated/models/message';
import { createMemo, type Accessor } from 'solid-js';

export type MessageSenderLookup = Map<string, string>;

type ChannelContextValue = {
  channel: Accessor<GetChannelResponse>;
  channelName: Accessor<string>;
  messages: Accessor<Message[]>;
  threads: Accessor<ReturnType<typeof getThreadMessages>>;
  reactions: Accessor<GetChannelResponseReactions>;
  attachments: Accessor<Attachment[]>;
  messageSenderMap: Accessor<MessageSenderLookup>;
  channelType: Accessor<ChannelType>;
};

type ChannelContextProps = {
  channelId: Accessor<string>;
};

export const [ChannelContextProvider, useChannelContext] =
  createAssertedContextProvider<ChannelContextValue>(
    'ChannelContext',
    (props: ChannelContextProps): ChannelContextValue => {
      const channelQuery = useChannelQuery(props.channelId);
      const channel = createMemo(() => channelQuery.data);
      const channelType = createMemo(() => channel().channel.channel_type);
      const channelName = createMemo(() => channel().channel.name ?? '');
      const messages = createMemo(() => getTopLevelMessages(channel()));
      const threads = createMemo(() => getThreadMessages(channel()));
      const reactions = createMemo(() => channel().reactions ?? {});
      const attachments = createMemo(() => channel().attachments ?? []);

      const messageSenderMap = createMemo(() => {
        const all = [...messages(), ...Object.values(threads()).flat()];
        return new Map(all.map((m) => [m.id, m.sender_id]));
      });

      return {
        channel,
        channelName,
        channelType,
        messages,
        threads,
        reactions,
        attachments,
        messageSenderMap,
      };
    }
  );
