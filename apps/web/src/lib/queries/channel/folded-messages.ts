import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { AgentChannelMessagesResponse } from '@service-storage/generated/schemas/agentChannelMessagesResponse';
import type { FoldedMessageDto } from '@service-storage/generated/schemas/foldedMessageDto';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { channelKeys } from './keys';

/**
 * Look up the folded agent-session message a placeholder channel message
 * renders, by the placeholder's `agent_session_message_id`.
 */
export type FoldedMessageLookup = (
  messageId: string
) => FoldedMessageDto | undefined;

/**
 * The folded messages of the agent session behind a channel.
 *
 * Enable only for channels of kind `agent`; a channel without a session 404s.
 * Nothing invalidates this over the websocket yet, so a short stale time
 * keeps reopened channels reasonably fresh without hammering the fold.
 */
export function useFoldedMessagesQuery(
  channelId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    queryKey: channelKeys.foldedMessages(channelId()).queryKey,
    queryFn: async () =>
      await throwOnErr(
        async () =>
          await storageServiceClient.getAgentChannelMessages({
            channel_id: channelId(),
          })
      ),
    enabled: enabled(),
    staleTime: 30_000,
    retry: (failureCount: number, error: Error) =>
      !thrownResultErrorHasCode(error, 'NOT_FOUND') && failureCount < 1,
  }));
}

/**
 * A reactive `agentSessionMessageId -> folded message` lookup.
 *
 * Every folded message is indexed, user prompts included: placeholders are
 * keyed per message rather than per turn, so a turn's prompt and its reply
 * are separate channel rows and each resolves to its own side.
 */
export function createFoldedMessageLookup(
  data: Accessor<AgentChannelMessagesResponse | undefined>
): FoldedMessageLookup {
  const byMessageId = createMemo(() => {
    const map = new Map<string, FoldedMessageDto>();
    for (const message of data()?.messages ?? []) {
      map.set(message.agentSessionMessageId, message);
    }
    return map;
  });

  return (messageId) => byMessageId().get(messageId);
}
