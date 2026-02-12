import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { EmailEntity } from '../types/entity';

type EmailStore = Record<string, EmailEntity>;

const singletonEmailStore = createStore<EmailStore>({});

export function useEmails() {
  const [store] = singletonEmailStore;
  return createMemo(() => Object.values(store));
}
