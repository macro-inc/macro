import type { Attachment, Model } from '@core/component/AI/types';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
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

// Debounced saves of a draft the user just sent must not land after the
// composer has already been cleared, or a remount shows the sent message again.
const chatStateSaveTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

function cancelChatStateSave(id: string) {
  const pending = chatStateSaveTimeouts[id];
  if (!pending) return;
  clearTimeout(pending);
  delete chatStateSaveTimeouts[id];
}

// debounced save chat state
function useStoreChatState() {
  return (id: string, state: Partial<StoredStuff>) => {
    cancelChatStateSave(id);
    chatStateSaveTimeouts[id] = setTimeout(() => {
      delete chatStateSaveTimeouts[id];
      setPersistentChatState(id, { ...state, used_at: Date.now() });
    }, 300);
  };
}

export const storeChatState = useStoreChatState();

export function storeChatStateImmediate(
  id: string,
  state: Partial<StoredStuff>
) {
  cancelChatStateSave(id);
  setPersistentChatState(id, { ...state, used_at: Date.now() });
}

/** Reactive model identity for icons, including models no longer in the picker. */
export function getChatStoredModel(id: string): string | undefined {
  return persistentChatState[id]?.model;
}

export function getChatInputStoredState(id: string): Partial<StoredStuff> {
  const storedStuff = untrack(() => persistentChatState[id]);
  if (!storedStuff) return {};

  // Let the composer try the server model before applying its default.
  const model = untrack(() => parseModel(getChatStoredModel(id)));
  setPersistentChatState(id, { ...storedStuff, used_at: Date.now() });
  return {
    ...storedStuff,
    model,
  };
}

// The new-chat soup composer has no chat id to key off of, so its draft model
// gets its own persisted slot (kept out of the LRU-bounded chat-state store so
// it's never purged). Like the per-chat draft model, this lets a model the user
// picked but hasn't sent yet survive reload/navigation.
const [soupModel, setSoupModel] = makePersisted(
  createSignal<Model | undefined>(undefined),
  {
    name: 'soup-chat-input-model',
  }
);

export function getSoupInputStoredModel(): Model | undefined {
  return parseModel(untrack(soupModel));
}

export function storeSoupInputModel(model: Model) {
  setSoupModel(model);
}
