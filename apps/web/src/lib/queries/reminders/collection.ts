import type { ReminderEntity } from '@entity';
import type { ReminderCollectionRow } from '@service-storage/generated/schemas/reminderCollectionRow';
import { reminderEntityFromData } from './entity';

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
