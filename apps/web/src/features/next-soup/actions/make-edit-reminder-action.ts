import { openReminderEditor } from '@app/features/reminders/reminder-composer';
import { reminderDescriptionForReference } from '@app/features/reminders/reminder-schedule';
import { ENABLE_REMINDERS } from '@core/constant/featureFlags';
import type { EntityData, ReminderEntity } from '@entity';
import { getItemPreview, isAccessiblePreviewItem } from '@queries/preview';
import type { SoupState } from '../create-soup-state';

/** The description a referenced reminder gets when its description is blank. */
async function fallbackDescriptionFor(
  entity: ReminderEntity
): Promise<string | undefined> {
  const reference = entity.referencedEntity;
  if (!reference) return undefined;

  try {
    const preview = await getItemPreview({
      id: reference.id,
      type: reference.type,
    });
    if (!isAccessiblePreviewItem(preview)) return undefined;
    return reminderDescriptionForReference(preview.rawName, reference.type);
  } catch {
    return undefined;
  }
}

/**
 * Edit an existing reminder — its description, its time, or both.
 *
 * `execute` opens the composer prefilled rather than writing anything: both
 * answers come from the user, so there is nothing to do until that modal
 * resolves. Single-entity only, like creating one.
 *
 * Recurring reminders are excluded. The composer only speaks one-shot
 * schedules, so editing one through it would quietly turn a cron into a single
 * firing. Nothing in the product creates a recurring reminder today, so this
 * excludes nothing a user can actually reach.
 */
export const makeEditReminderAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    ENABLE_REMINDERS() &&
    entity.type === 'reminder' &&
    entity.scheduleType === 'once';

  const execute = (entities: EntityData[]): void | Promise<void> => {
    const [entity] = entities;
    // Re-checked rather than assumed: a stale command-menu entry could
    // otherwise still fire against a row that has since changed.
    if (!entity || entity.type !== 'reminder' || !canExecute(entity)) return;

    const openEditor = (fallbackDescription?: string) => {
      openReminderEditor({
        id: entity.id,
        description: entity.description,
        remindAt: new Date(entity.nextRunAt),
        completed: entity.completedAt != null,
        fallbackDescription,
      });
    };
    if (!entity.referencedEntity) {
      openEditor();
      return;
    }
    return fallbackDescriptionFor(entity).then(openEditor);
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are.
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
