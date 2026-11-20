import { Telemetry } from '@macro-inc/observability';
import type { RemoteParticipant, Room } from 'livekit-client';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  CALL_REACTION_EMOJIS,
  CALL_REACTION_LIFETIME_MS,
  CALL_REACTION_TOPIC,
  type CallReaction,
  type CallReactionEmoji,
  decodeCallReaction,
} from '../core/call-reactions';
import { LK_ROOM_EVENT } from '../livekit-loader';

export function createCallReactions(room: Accessor<Room | null | undefined>) {
  const [entries, setEntries] = createSignal<CallReaction[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let nextId = 0;
  let disposed = false;
  const add = (sender: string, emoji: CallReactionEmoji) => {
    // Bound transient reactions, then expire each entry independently. Timers
    // belong to the room subscription so reconnecting cannot replay old reactions.
    if (!sender || entries().length >= 20) return;
    const id = ++nextId;
    setEntries((items) => [...items, { id, sender, emoji }]);
    const timer = setTimeout(() => {
      timers.delete(timer);
      setEntries((items) => items.filter((item) => item.id !== id));
    }, CALL_REACTION_LIFETIME_MS);
    timers.add(timer);
  };
  createEffect(
    on(room, (active) => {
      if (!active) return;
      const receive = (
        payload: Uint8Array,
        participant?: RemoteParticipant,
        _kind?: unknown,
        topic?: string
      ) => {
        const staleRoom = room() !== active;
        const wrongTopic = topic !== CALL_REACTION_TOPIC;
        if (staleRoom || wrongTopic || !participant) return;
        if (participant.identity === active.localParticipant.identity) return;
        const emoji = decodeCallReaction(payload);
        if (emoji) add(participant.identity, emoji);
      };
      active.on(LK_ROOM_EVENT.DataReceived, receive);
      onCleanup(() => {
        active.off(LK_ROOM_EVENT.DataReceived, receive);
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        setEntries([]);
      });
    })
  );
  onCleanup(() => {
    disposed = true;
  });
  const send = async (emoji: CallReactionEmoji) => {
    const active = room();
    if (!active || !CALL_REACTION_EMOJIS.includes(emoji)) return;
    await Telemetry.span('call.reaction.send', async () => {
      await active.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ version: 1, emoji })),
        { topic: CALL_REACTION_TOPIC, reliable: false }
      );
    });
    if (!disposed && room() === active)
      add(active.localParticipant.identity, emoji);
  };
  return { entries, send };
}
