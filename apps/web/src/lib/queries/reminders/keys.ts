import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ListRemindersParams } from '@service-storage/generated/schemas/listRemindersParams';

export const reminderKeys = createQueryKeys('reminders', {
  /**
   * One page of reminders for a given filter. Use `reminderKeys.list._def` to
   * invalidate every list regardless of filter.
   */
  list: (params: ListRemindersParams = {}) => [params],
  /** A single reminder by id. */
  detail: (id: string) => [id],
});
