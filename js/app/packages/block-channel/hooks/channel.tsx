import { useChannelName } from '@core/context/channels';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { useChannelQuery } from '@queries/channel/channel';
import {
  flattenMessages,
  type useChannelMessagesQuery,
} from '@queries/channel/channel-messages';
import type {
  ApiChannelMessage,
  ChannelMessagesPage,
} from '@service-comms/client';
import type {
  ChannelType,
  GetChannelResponse,
} from '@service-comms/generated/models';
import type { InfiniteData } from '@tanstack/solid-query';
import { createMemo, type Accessor } from 'solid-js';

export type MessageSenderLookup = Map<string, string>;

type ChannelContextValue = {
  // channel: Accessor<GetChannelResponse>;
  channelName: Accessor<string>;
  channelType: Accessor<ChannelType>;
  messages: Accessor<ApiChannelMessage[]>;
  messageSenderMap: Accessor<MessageSenderLookup>;
  fetchNextPage: () => void;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
};

type ChannelContextProps = {
  messagesQuery: ReturnType<typeof useChannelMessagesQuery>;
  channelName: Accessor<string>;
  channelType: Accessor<ChannelType>;
};

export const [ChannelContextProvider, useChannelContext] =
  createAssertedContextProvider<ChannelContextValue>(
    'ChannelContext',
    (props: ChannelContextProps): ChannelContextValue => {
      const messages = createMemo(() =>
        flattenMessages(
          props.messagesQuery.data as
            | InfiniteData<ChannelMessagesPage, string | null>
            | undefined
        )
      );

      const messageSenderMap = createMemo(() => {
        const msgs = messages();
        const map = new Map<string, string>();
        for (const m of msgs) {
          map.set(m.id, m.sender_id);
          for (const reply of m.thread.preview) {
            map.set(reply.id, reply.sender_id);
          }
        }
        return map;
      });

      const fetchNextPage = () => props.messagesQuery.fetchNextPage();
      const hasNextPage = createMemo(() => props.messagesQuery.hasNextPage);
      const isFetchingNextPage = createMemo(
        () => props.messagesQuery.isFetchingNextPage
      );

      return {
        channelName: props.channelName,
        channelType: props.channelType,
        messages,
        messageSenderMap,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
      };
    }
  );
