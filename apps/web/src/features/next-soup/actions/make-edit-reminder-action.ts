import { openReminderEditor } from '@app/features/reminders/reminder-composer';
import {
  reminderDescriptionForReference,
  scheduleFromRow,
} from '@app/features/reminders/reminder-schedule';
import { ENABLE_REMINDERS } from '@core/constant/featureFlags';
import type { EntityData, ReminderEntity } from '@entity';
import {
  getCachedItemPreview,
  isAccessiblePreviewItem,
} from '@queries/preview';
import type { SoupState } from '../create-soup-state';

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
 * Edit an existing reminder — its description, its schedule, or both.
 *
 * `execute` opens the composer prefilled rather than writing anything: both
 * answers come from the user, so there is nothing to do until that modal
 * resolves. Single-entity only, like creating one.
 */
export const makeEditReminderAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    ENABLE_REMINDERS() && entity.type === 'reminder';

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    // Re-checked rather than assumed: a stale command-menu entry could
    // otherwise still fire against a row that has since changed.
    if (!entity || entity.type !== 'reminder' || !canExecute(entity)) return;

    openReminderEditor({
      id: entity.id,
      description: entity.description,
      remindAt: new Date(entity.nextRunAt),
      schedule: scheduleFromRow(entity),
      completed: entity.completedAt != null,
      fallbackDescription: fallbackDescriptionFor(entity),
    });
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are.
    execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
