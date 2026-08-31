import type { ReminderEntity } from '@entity';
import {
  getCachedItemPreview,
  isAccessiblePreviewItem,
} from '@queries/preview';
import { openReminderEditor } from './reminder-composer';
import {
  reminderDescriptionForReference,
  scheduleFromRow,
} from './reminder-schedule';

/**
 * The description this reminder would get if it were being created now, for a
 * blank description to fall back to.
 *
 * Read from the preview cache rather than fetched: the row the editor was
 * opened from has already rendered this name, so it is cached. A miss returns
 * undefined and the editor keeps the existing description instead — better than
 * blocking on a request to answer a question the user may not even ask.
 */
function fallbackDescriptionFor(entity: ReminderEntity): string | undefined {
  const reference = entity.referencedEntity;
  if (!reference) return undefined;

  const cached = getCachedItemPreview(reference.id);
  if (!cached || !isAccessiblePreviewItem(cached)) return undefined;

  return reminderDescriptionForReference(cached.rawName, reference.type);
}

/**
 * Open the reminder editor prefilled from a soup row.
 *
 * Shared by the "Edit reminder" action and the row click, so both open the same
 * panel with the same prefill — everything the editor needs comes from the row,
 * so opening it costs no request.
 */
export function openReminderEditorForEntity(entity: ReminderEntity) {
  openReminderEditor({
    id: entity.id,
    description: entity.description,
    remindAt: new Date(entity.nextRunAt),
    schedule: scheduleFromRow(entity),
    completed: entity.completedAt != null,
    fallbackDescription: fallbackDescriptionFor(entity),
    referencedEntity: entity.referencedEntity,
  });
}
