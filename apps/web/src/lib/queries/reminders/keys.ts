import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ListEmailRemindersParams } from '@service-storage/generated/schemas/listEmailRemindersParams';

export const reminderKeys = createQueryKeys('reminders', {
  email: (threadId: string) => [threadId],
  emailCollection: (
    userId: string | undefined,
    filters: ListEmailRemindersParams
  ) => [userId, filters],
});
