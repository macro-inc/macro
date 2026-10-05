import { throwOnErr } from '@core/util/result';
import type { ReminderEntity } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import type { ReminderCollectionPage } from '@service-storage/generated/schemas/reminderCollectionPage';
import type { ReminderCollectionRow } from '@service-storage/generated/schemas/reminderCollectionRow';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import type { SoupAstItemsData } from '../soup/items';
import { reminderEntityFromData } from './entity';
import { reminderKeys } from './keys';

export function collectionReminderEntity(
  row: ReminderCollectionRow
): ReminderEntity {
  const reminder = row.reminder;
  const entity = reminderEntityFromData({
    ...reminder,
    referencedEntity:
      reminder.entityId && reminder.entityType
        ? {
            id: reminder.entityId,
            entityType: reminder.entityType,
            fileType: row.reference?.fileType,
            subType: row.reference?.subType,
          }
        : undefined,
  });
  return { ...entity, emailFollowup: row.emailFollowup ?? undefined };
}

/** One paginated query per collection; source metadata and workflow facts arrive together. */
export function useReminderCollectionQuery(
  options: Accessor<{
    userId: string | undefined;
    enabled: boolean;
    completed?: boolean;
  }>
) {
  return useInfiniteQuery(() => {
    const { userId, completed, enabled } = options();
    return {
      queryKey: reminderKeys.collection(userId, completed).queryKey,
      enabled: !!userId && enabled,
      // Delivery, reply cancellation and recurring firings also happen server-side.
      // One collection timer refreshes those transitions, never one timer per row.
      refetchInterval: 30_000,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        throwOnErr(() =>
          storageServiceClient.reminders.listCollection({
            cursor: pageParam,
            completed,
            limit: 100,
          })
        ),
      getNextPageParam: (page: ReminderCollectionPage) =>
        page.nextCursor ?? undefined,
      select: (data): SoupAstItemsData => ({
        entities: data.pages.flatMap((page) =>
          page.items.map(collectionReminderEntity)
        ),
        groups: undefined,
      }),
    };
  });
}

/** Confirmed writes update rows in place; completion alone never removes an unfiltered row. */
export function updateReminderCollection(reminder: Reminder) {
  for (const [key, data] of queryClient.getQueriesData<
    InfiniteData<ReminderCollectionPage>
  >({ queryKey: reminderKeys.collection._def })) {
    if (!data) continue;
    const filters = key.at(-1);
    const completed =
      typeof filters === 'object' && filters !== null && 'completed' in filters
        ? filters.completed
        : undefined;
    const matches =
      typeof completed !== 'boolean' ||
      (reminder.completedAt != null) === completed;
    queryClient.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.flatMap((row) =>
          row.reminder.id !== reminder.id
            ? [row]
            : matches
              ? [{ ...row, reminder }]
              : []
        ),
      })),
    });
  }
}
