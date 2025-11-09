import type { Attachment, Model } from '@core/component/AI/types';
import { makePersisted } from '@solid-primitives/storage';
import { untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { DEFAULT_MODEL } from '../constant';
import { parseModel } from './parse';

export type StoredStuff = {
  input: string;
  attachments: Attachment[];
  model: Model;
};

// this clears the old method of storing every chat input + attachments forever
function clearOldEntries() {
  Object.keys(localStorage).forEach((key) => {
    // remove chat input + attachments
    if (key.startsWith('chat-input-') || key.startsWith('chat-attachments-'))
      localStorage.removeItem(key);
    // there is only one model clear old models if users have them
    if (key.startsWith('active-model')) localStorage.removeItem(key);
  });
}

clearOldEntries();

const MAX_ENTRIES = 10;

type StateStore = Record<string, Partial<StoredStuff> & { used_at: number }>;

const [persistentChatState, setPersistentChatState] = makePersisted(
  createStore<StateStore>({}),
  {
    name: 'chat-state',
  }
);

function purgeLRU() {
  const entries = persistentChatState;
  const descEntries = Object.entries(entries)
    // larger(newer) things come first. negative return -> a first
    .sort(([_a, va], [_b, vb]) => vb.used_at - va.used_at)
    // slice out anything beyond max entries
    .slice(0, MAX_ENTRIES);
  const obj = Object.fromEntries(descEntries);
  setPersistentChatState(reconcile(obj));
}
purgeLRU();

// debounced save chat state
function useStoreChatState() {
  const timeouts: Record<string, ReturnType<typeof setTimeout>> = {};
  return (id: string, state: Partial<StoredStuff>) => {
    if (timeouts[id]) clearTimeout(timeouts[id]);
    timeouts[id] = setTimeout(() => {
      const updated_at = Date.now();
      setPersistentChatState(id, { ...state, used_at: updated_at });
    }, 300);
  };
}

export const storeChatState = useStoreChatState();

export function getChatInputStoredState(id: string): Partial<StoredStuff> {
  const storedStuff = untrack(() => persistentChatState[id]);
  if (!storedStuff) return {};

  const model = parseModel(storedStuff.model) ?? DEFAULT_MODEL;
  setPersistentChatState(id, { ...storedStuff, used_at: Date.now() });
  return {
    ...storedStuff,
    model,
  };
}
