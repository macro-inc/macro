import type { ReminderEntity } from '@entity';
import { createContext, useContext } from 'solid-js';

export type EmailRowReminder = { nearest: ReminderEntity; count: number };

/** Optional collection capability: rows without an owner never start queries. */
export type EmailRowReminders = {
  register(threadId: string): () => void;
  get(threadId: string): EmailRowReminder | undefined;
};
const Context = createContext<EmailRowReminders>();
export const EmailRowRemindersProvider = Context.Provider;
export const useEmailRowReminders = () => useContext(Context);
