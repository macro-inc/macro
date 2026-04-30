import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

const STORE_NAME = 'command-recency-v1';

// stores command id -> last used timestamp in ms
type RecencyStore = Record<string, number>;

const [recencyStore, setRecencyStore] = makePersisted(
  createStore<RecencyStore>({}),
  { name: STORE_NAME }
);

export function trackCommandUsage(commandId: string): void {
  setRecencyStore(commandId, Date.now());
}

export function getCommandLastUsedAt(commandId: string): Date | null {
  const timestamp = recencyStore[commandId];
  return timestamp ? new Date(timestamp) : null;
}
