import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

export const [rightbarChatId, setRightbarChatId] = makePersisted(
  createSignal<string | undefined>(undefined),
  {
    name: 'rightbarChatId',
    storage: sessionStorage,
  }
);
