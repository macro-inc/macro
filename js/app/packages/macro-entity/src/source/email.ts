import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { EmailEntity } from '@entity';

type EmailStore = Record<string, EmailEntity>;

const singletonEmailStore = createStore<EmailStore>({});

/** @deprecated this is empty until we migrate to the new email query */
export function useEmails() {
  const [store] = singletonEmailStore;
  return createMemo(() => Object.values(store));
}
