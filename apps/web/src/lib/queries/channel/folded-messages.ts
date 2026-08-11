import type { MessageId } from '@core/agent-fold/message-id';
import type { FoldedMessage } from '@core/agent-fold/types';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
import { useQueryClient } from '@tanstack/solid-query';
import {
  type Accessor,
  createResource,
  onCleanup,
  type Resource,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { rememberSessionBot } from './agent-session-placeholders';
import {
  abandonAgentSessionStream,
  beginAgentSessionStream,
  followAgentSession,
} from './agent-session-stream';
import { channelKeys } from './keys';

/**
 * Look up the folded agent-session message a placeholder channel message
 * renders, by the turn and author the placeholder names.
 *
 * **Reactive.** The lookup reads a store the live stream writes into, so a
 * caller reading it inside a tracking scope re-runs when the session appends
 * to the message it is showing. That is the whole rendering path for a live
 * agent turn: no message is refetched, the fold just gets longer.
 */
export type FoldedMessageLookup = (
  agentSessionId: string,
  messageId: MessageId
) => FoldedMessage | undefined;

/**
 * Fetch an agent channel's protocol log, fold it, and keep folding it.
 *
 * The server does not fold any more — it serves the frames and this folds
 * them — so both halves live behind one resource and an agent channel has a
 * single "ready" to gate on. Once the log is folded, the channel follows the
 * session over the websocket through the same fold machine, so nothing is
 * refetched for the rest of the session.
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
 *
 * While `enabled` is false nothing runs — no fetch, no stream, no fold
 * worker — and the resource stays unresolved, which reads as `undefined`
 * without suspending. Flipping it on starts the fetch for the current
 * channel.
 */
export function createFoldedMessages(
  channelId: Accessor<string>,
  enabled: Accessor<boolean>,
  options?: {
    observeEntries?: (entries: AgentSessionLogEntryDto[]) => void;
  }
): Resource<FoldedMessageLookup> {
  const queryClient = useQueryClient();

  // The store, not the resource, is what makes a folded message reactive: the
  // resource resolves once per channel, while a live turn changes its message
  // hundreds of times. Consumers read through the lookup below, so the read
  // lands in their own tracking scope and only the rows whose message changed
  // re-render.
  const [bySessionId, setBySessionId] = createStore<
    Record<string, Record<number, Partial<Record<string, FoldedMessage>>>>
  >({});
  const lookup: FoldedMessageLookup = (sessionId, { turn, author }) =>
    bySessionId[sessionId]?.[turn]?.[author];

  const remember = (messages: FoldedMessage[]) =>
    setBySessionId(
      produce((current) => {
        for (const message of messages) {
          const { agentSessionId, turn } = message;
          current[agentSessionId] ??= {};
          const session = current[agentSessionId];
          session[turn] ??= {};
          session[turn][message.author.kind] = message;
        }
      })
    );

  let unfollow: (() => void) | undefined;
  const stopFollowing = () => {
    unfollow?.();
    unfollow = undefined;
  };

  // Opening a fold is async and following one holds a machine open, so both
  // ends of a run have to be able to tell that the run is over: the channel
  // moved on to another id, or the view closed while the log was in flight.
  // Without this a superseded run leaks its reader and its machine.
  let generation = 0;
  let closed = false;
  onCleanup(() => {
    closed = true;
    stopFollowing();
  });

  const [folded] = createResource(
    () => (enabled() ? channelId() : undefined),
    async (id): Promise<FoldedMessageLookup> => {
      const run = ++generation;
      const superseded = () => closed || generation !== run;

      stopFollowing();
      setBySessionId(reconcile({}));

      // Before the fetch, deliberately: frames that arrive while it is in
      // flight belong after the snapshot it returns, and only a buffered
      // frame can be told apart from one the snapshot already contains.
      beginAgentSessionStream(id);

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
          // The websocket keeps this channel's fold current, so the cached log
          // only matters for a channel reopened after its stream was dropped.
          staleTime: 0,
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
      if (log) options?.observeEntries?.(log.entries);

      // Before following, so the first frame of the first turn already has an
      // agent to attribute its message to.
      rememberSessionBot(id, log?.bot);

      // No session id means no agent session owns this channel - the ordinary
      // answer for most channels, and nothing to fold or follow.
      const sessionId = log?.agentSessionId;
      if (!sessionId || superseded()) {
        abandonAgentSessionStream(id);
        return lookup;
      }

      try {
        const followed = await followAgentSession({
          channelId: id,
          sessionId,
          fetched: log.entries,
          sink: remember,
        });
        if (superseded()) {
          followed.unfollow();
          return lookup;
        }
        unfollow = followed.unfollow;
        remember(followed.messages);

        console.info('[agent-fold] folded', {
          acpMessages: log.entries.length,
          messages: followed.messages.length,
          ids: followed.messages.map(
            (message) =>
              `${message.agentSessionId}/${message.turn}/${message.author.kind}`
          ),
        });
      } catch (error) {
        // Same trade as a failed fetch: an unfoldable log leaves the
        // placeholders bodyless rather than taking the channel down with it.
        console.error('[agent-fold] log could not be folded', error);
        abandonAgentSessionStream(id);
      }

      return lookup;
    }
  );

  return folded;
}
