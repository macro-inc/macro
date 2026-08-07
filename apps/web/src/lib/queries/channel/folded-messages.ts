import { foldSession } from '@core/agent-fold/client';
import type { FoldedMessage } from '@core/agent-fold/types';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { AgentChannelLogResponse } from '@service-storage/generated/schemas/agentChannelLogResponse';
import { useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createResource, type Resource } from 'solid-js';
import { channelKeys } from './keys';

/**
 * Look up the folded agent-session message a placeholder channel message
 * renders, by the placeholder's `agent_session_message_id`.
 */
export type FoldedMessageLookup = (
  messageId: string
) => FoldedMessage | undefined;

/**
 * Fetch an agent channel's protocol log and fold it, as one thing to wait on.
 *
 * The server does not fold any more — it serves the frames and this folds
 * them — so both halves live behind one resource and an agent channel has a
 * single "ready" to gate on.
 *
 * Asked of **every** channel, agent or not. Knowing which is which first
 * would mean consulting the channel record, and nothing fetches that per
 * channel - it arrives as part of a cached list that can predate the channel
 * being opened, which is exactly how this silently folded nothing before. The
 * endpoint answers an empty log for a channel with no session, so the question
 * is cheap and always safe to ask.
 *
 * **Reading this suspends.** The channel reads it inside its `<Suspense>` so
 * nothing renders until the messages are folded: the fold is fast, and a
 * channel that appears and then fills itself in a message at a time looks
 * worse than one that appears complete. This runs in parallel with the
 * messages query, which the channel already waits on, so an ordinary channel
 * pays nothing for asking.
 *
 * It resolves rather than rejects when the log cannot be fetched: a suspended
 * resource that throws would take the whole channel down with it, and
 * placeholders with nothing behind them are much the milder failure.
 */
export function createFoldedMessages(
  channelId: Accessor<string>
): Resource<FoldedMessageLookup> {
  const queryClient = useQueryClient();

  const [folded] = createResource(
    channelId,
    async (id): Promise<FoldedMessageLookup> => {
      const log = await queryClient
        .fetchQuery({
          queryKey: channelKeys.foldedMessages(id).queryKey,
          queryFn: async () =>
            await throwOnErr(
              async () =>
                await storageServiceClient.getAgentChannelLog({
                  channel_id: id,
                })
            ),
          // Nothing invalidates this over the websocket yet, so a short stale
          // time keeps reopened channels reasonably fresh.
          staleTime: 30_000,
        })
        .catch((error: unknown) => {
          // A channel with no agent session is answered, not an error, so this
          // really is a fault - a warning and an empty channel rather than a
          // throw that would take the channel down.
          console.warn('[agent-fold] log could not be fetched', error);
          return undefined;
        });

      console.info('[agent-fold] log fetched', {
        channelId: id,
        agentSessionId: log?.agentSessionId ?? '(none - not an agent channel)',
        acpMessages: log?.entries.length ?? 0,
      });

      return await foldToLookup(log);
    }
  );

  return folded;
}

/**
 * Fold a session's log and index it by `agentSessionMessageId`.
 *
 * The fold is `agent_fold` compiled to WASM, run in a worker — the same code
 * the server folds with, so a channel and a reload cannot disagree about what
 * a log means.
 *
 * Every folded message is indexed, user prompts included: placeholders are
 * keyed per message rather than per turn, so a turn's prompt and its reply are
 * separate channel rows and each resolves to its own side.
 */
async function foldToLookup(
  log: AgentChannelLogResponse | undefined
): Promise<FoldedMessageLookup> {
  const byMessageId = new Map<string, FoldedMessage>();

  // No session id means no agent session owns this channel - the ordinary
  // answer for most channels, and nothing to fold.
  const sessionId = log?.agentSessionId;
  if (sessionId) {
    try {
      const folded = await foldSession(sessionId, log.entries);
      console.info('[agent-fold] folded', {
        acpMessages: log.entries.length,
        messages: folded.length,
        ids: folded.map((message) => message.agentSessionMessageId),
        result: folded,
      });
      for (const message of folded) {
        byMessageId.set(message.agentSessionMessageId, message);
      }
    } catch (error) {
      // Same trade as a failed fetch: an unfoldable log leaves the
      // placeholders bodyless rather than taking the channel down with it.
      console.error('[agent-fold] log could not be folded', error);
    }
  }

  return (messageId) => byMessageId.get(messageId);
}
