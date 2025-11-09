import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

export const [rightbarChatId, setRightbarChatId] = makePersisted(
  createSignal<string | undefined>(undefined),
  {
    name: 'rightbarChatId',
    storage: sessionStorage,
  }
);

// TODO: probably not needed
// NOTE: this can be fully deprecated once sidebar is fully deprecated
export const [rightbarOpenOnce, setRightbarOpenOnce] = makePersisted(
  createSignal(true),
  {
    name: 'rightbarOpenOnce',
  }
);
