import { openReminderEditor } from '@app/features/reminders/reminder-composer';
import { ENABLE_REMINDERS } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';

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

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    // Re-checked rather than assumed: a stale command-menu entry could
    // otherwise still fire against a row that has since changed.
    if (!entity || entity.type !== 'reminder' || !canExecute(entity)) return;

    openReminderEditor({
      id: entity.id,
      description: entity.description,
      remindAt: new Date(entity.nextRunAt),
      completed: entity.completedAt != null,
    });
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are.
    execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
