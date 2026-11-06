import { Telemetry } from '@macro-inc/observability';
import type { RemoteParticipant, Room } from 'livekit-client';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { LK_ROOM_EVENT } from './livekit-loader';

export const CALL_REACTION_EMOJIS = ['👍', '👏', '😂', '❤️', '🎉'] as const;
export type CallReactionEmoji = (typeof CALL_REACTION_EMOJIS)[number];
export type CallReaction = {
  id: number;
  sender: string;
  emoji: CallReactionEmoji;
};
export const CALL_REACTION_TOPIC = 'macro.call.reaction.v1';

export function decodeCallReaction(
  payload: Uint8Array
): CallReactionEmoji | undefined {
  if (payload.byteLength > 256) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('emoji' in value)
    )
      return undefined;
    return CALL_REACTION_EMOJIS.find((emoji) => emoji === value.emoji);
  } catch {
    return undefined;
  }
}

export function createCallReactions(room: Accessor<Room | null | undefined>) {
  const [entries, setEntries] = createSignal<CallReaction[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let nextId = 0;
  let disposed = false;
  const add = (sender: string, emoji: CallReactionEmoji) => {
    if (!sender || entries().length >= 20) return;
    const id = ++nextId;
    setEntries((items) => [...items, { id, sender, emoji }]);
    const timer = setTimeout(() => {
      timers.delete(timer);
      setEntries((items) => items.filter((item) => item.id !== id));
    }, 1800);
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
        if (
          room() !== active ||
          topic !== CALL_REACTION_TOPIC ||
          !participant ||
          participant.identity === active.localParticipant.identity
        )
          return;
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
