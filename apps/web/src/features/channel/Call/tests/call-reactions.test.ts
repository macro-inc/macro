import type { Room } from 'livekit-client';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CALL_REACTION_TOPIC,
  createCallReactions,
  decodeCallReaction,
} from '../call-reactions';

type Receive = (
  payload: Uint8Array,
  participant: { identity: string },
  kind: undefined,
  topic: string
) => void;
const payload = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
afterEach(() => vi.useRealTimers());

it('accepts only the versioned reaction allowlist', () => {
  expect(decodeCallReaction(payload({ version: 1, emoji: '👏' }))).toBe('👏');
  expect(
    decodeCallReaction(payload({ version: 2, emoji: '👏' }))
  ).toBeUndefined();
  expect(
    decodeCallReaction(payload({ version: 1, emoji: 'unknown' }))
  ).toBeUndefined();
  expect(decodeCallReaction(new Uint8Array(300))).toBeUndefined();
});

it('publishes ephemeral messages, uses transport sender identity, and expires reactions', async () => {
  vi.useFakeTimers();
  let receive: Receive | undefined;
  const publishData = vi.fn(async () => {});
  const off = vi.fn();
  const room = {
    localParticipant: { identity: 'local', publishData },
    on: (_name: string, handler: Receive) => {
      receive = handler;
    },
    off,
  } as unknown as Room;
  const { reactions, dispose } = createRoot((dispose) => ({
    reactions: createCallReactions(() => room),
    dispose,
  }));
  await reactions.send('👍');
  expect(publishData).toHaveBeenCalledWith(
    payload({ version: 1, emoji: '👍' }),
    { topic: CALL_REACTION_TOPIC, reliable: false }
  );
  receive?.(
    payload({ version: 1, emoji: '👏', sender: 'spoofed' }),
    { identity: 'remote' },
    undefined,
    CALL_REACTION_TOPIC
  );
  expect(reactions.entries().map((item) => item.sender)).toEqual([
    'local',
    'remote',
  ]);
  receive?.(
    payload({ version: 1, emoji: '👏' }),
    { identity: 'remote' },
    undefined,
    'another-topic'
  );
  expect(reactions.entries()).toHaveLength(2);
  vi.advanceTimersByTime(1800);
  expect(reactions.entries()).toEqual([]);
  dispose();
  expect(off).toHaveBeenCalled();
});

it('ignores stale room events and late local sends after a room switch', async () => {
  let receive: Receive | undefined;
  let complete!: () => void;
  const room = {
    localParticipant: {
      identity: 'local',
      publishData: () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    },
    on: (_name: string, handler: Receive) => {
      receive = handler;
    },
    off: () => {},
  } as unknown as Room;
  const state = createRoot((dispose) => {
    const [active, setActive] = createSignal<Room | undefined>(room);
    return { reactions: createCallReactions(active), setActive, dispose };
  });
  const send = state.reactions.send('❤️');
  state.setActive(undefined);
  receive?.(
    payload({ version: 1, emoji: '👏' }),
    { identity: 'remote' },
    undefined,
    CALL_REACTION_TOPIC
  );
  complete();
  await send;
  expect(state.reactions.entries()).toEqual([]);
  state.dispose();
});
