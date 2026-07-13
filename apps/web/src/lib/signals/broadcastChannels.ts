import { createSignal } from 'solid-js';

export const [broadcastChannels, setBroadcastChannels] = createSignal<
  Map<string, BroadcastChannel>
>(new Map<string, BroadcastChannel>());
