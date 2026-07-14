import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

export const [cachedInputStore, setCachedInputStore] = makePersisted(
  createStore<
    Partial<{
      [key: string]: string;
    }>
  >({}),
  {
    name: 'cachedChatInputStore',
  }
);
