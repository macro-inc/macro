import { createSignal } from 'solid-js';

export const [connectionsRest, setConnectionsRest] = createSignal<
  string | null
>(null);
