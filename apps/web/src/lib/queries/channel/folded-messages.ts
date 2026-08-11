import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { FoldedMessageDto } from '@service-storage/generated/schemas/foldedMessageDto';
import { useQueryClient } from '@tanstack/solid-query';
import {
  type Accessor,
  createResource,
  onCleanup,
  type Resource,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import {
  type AgentSessionMessageEvent,
  followAgentSessionMessages,
} from './agent-session-messages';
import {
  ensureAgentSessionPlaceholder,
  rememberSessionBot,
} from './agent-session-placeholders';
import { channelKeys } from './keys';

/**
 * Look up the folded agent-session message a placeholder channel message
 * renders, by the placeholder's `agent_session_message_id`.
 *
 * **Reactive.** The lookup reads a store the live stream writes into, so a
 * caller reading it inside a tracking scope re-runs when the session appends
 * to the message it is showing. That is the whole rendering path for a live
 * agent turn: no message is refetched, the server just sends it again longer.
 */
export type FoldedMessageLookup = (
  messageId: string
) => FoldedMessageDto | undefined;

/**
 * Fetch an agent channel's folded messages and keep them current.
 *
 * The server folds — this fetches the snapshot and then overlays the
 * `agent_session_message` events the websocket delivers, each of which
 * carries a whole message to store under its id. Events received while the
 * fetch is in flight are buffered and applied after it, minus the ones the
 * snapshot already contains (`logIndex <= logLength` — see
 * `agent-session-messages.ts`).
 *
 * Asked of **every** channel, agent or not. Knowing which is which first
 * would mean consulting the channel record, and nothing fetches that per
 * channel - it arrives as part of a cached list that can predate the channel
 * being opened. The endpoint answers empty for a channel with no session, so
 * the question is cheap and always safe to ask.
 *
 * **Reading this suspends.** The channel reads it inside its `<Suspense>` so
 * nothing renders until the messages are here: a channel that appears and
 * then fills itself in a message at a time looks worse than one that appears
 * complete. This runs in parallel with the messages query, which the channel
 * already waits on, so an ordinary channel pays nothing for asking.
 *
 * It resolves rather than rejects when the fetch fails: a suspended resource
 * that throws would take the whole channel down with it, and placeholders
 * with nothing behind them are much the milder failure.
 *
 * While `enabled` is false nothing runs — no fetch, no follow — and the
 * resource stays unresolved, which reads as `undefined` without suspending.
 * Flipping it on starts the fetch for the current channel.
 */
export function createFoldedMessages(
  channelId: Accessor<string>,
  enabled: Accessor<boolean>
): Resource<FoldedMessageLookup> {
  const queryClient = useQueryClient();

  // The store, not the resource, is what makes a folded message reactive: the
  // resource resolves once per channel, while a live turn changes its message
  // hundreds of times. Consumers read through the lookup below, so the read
  // lands in their own tracking scope and only the rows whose message changed
  // re-render.
  const [byMessageId, setByMessageId] = createStore<
    Record<string, FoldedMessageDto>
  >({});
  const lookup: FoldedMessageLookup = (messageId) => byMessageId[messageId];

  const remember = (messages: FoldedMessageDto[]) =>
    setByMessageId(
      produce((current) => {
        for (const message of messages) {
          current[message.agentSessionMessageId] = message;
        }
      })
    );

  let unfollow: (() => void) | undefined;
  const stopFollowing = () => {
    unfollow?.();
    unfollow = undefined;
  };

  // A superseded run - the channel moved on to another id, or the view closed
  // while the fetch was in flight - must stop listening rather than keep
  // writing into a store nothing reads.
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
      setByMessageId(reconcile({}));

      // Until the snapshot lands there is nothing to align an event against,
      // so hold what arrives; afterwards events apply directly.
      let snapshotLogLength: number | undefined;
      let buffered: AgentSessionMessageEvent[] = [];

      const apply = (event: AgentSessionMessageEvent) => {
        // Already contained in the snapshot - see agent-session-messages.ts.
        if (event.logIndex <= (snapshotLogLength ?? 0)) return;
        remember([event.message]);
        // A message the server just derived has a placeholder row in the
        // database, but nothing pushes that row to open channels - so make
        // one locally and let the real row adopt it when it arrives.
        if (event.kind === 'new') {
          void ensureAgentSessionPlaceholder(id, event.message);
        }
      };

      // Before the fetch, deliberately: an event that arrives while it is in
      // flight may or may not be in the snapshot, and only a held event can
      // be filtered against it afterwards.
      const stop = followAgentSessionMessages(id, (event) => {
        if (snapshotLogLength === undefined) {
          buffered.push(event);
        } else {
          apply(event);
        }
      });
      unfollow = stop;

      const snapshot = await queryClient
        .fetchQuery({
          queryKey: channelKeys.foldedMessages(id).queryKey,
          queryFn: async () =>
            await throwOnErr(
              async () =>
                await storageServiceClient.getAgentChannelMessages({
                  channel_id: id,
                })
            ),
          // The websocket keeps this channel current, so the cached snapshot
          // only matters for a channel reopened after its stream was dropped.
          staleTime: 30_000,
        })
        .catch((error: unknown) => {
          // A channel with no agent session is answered, not an error, so
          // this really is a fault - a warning and an empty channel rather
          // than a throw that would take the channel down.
          console.warn('[agent-fold] messages could not be fetched', error);
          return undefined;
        });

      if (superseded()) {
        stopFollowing();
        return lookup;
      }

      rememberSessionBot(id, snapshot?.bot);

      // No session id means no agent session owns this channel - the
      // ordinary answer for most channels, and nothing to follow.
      if (!snapshot?.agentSessionId) {
        stopFollowing();
        return lookup;
      }

      remember(snapshot.messages);
      snapshotLogLength = snapshot.logLength;
      for (const event of buffered) apply(event);
      buffered = [];

      console.info('[agent-fold] folded messages fetched', {
        channelId: id,
        agentSessionId: snapshot.agentSessionId,
        messages: snapshot.messages.length,
        logLength: snapshot.logLength,
      });

      return lookup;
    }
  );

  return folded;
}
