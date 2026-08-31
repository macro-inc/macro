import { openReminderEditorForEntity } from '@app/features/reminders/open-reminder-editor';
import { ENABLE_REMINDERS } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type { EntityActionListState } from './entity-action-context';

/**
 * Edit an existing reminder — its description, its schedule, or both.
 *
 * `execute` opens the composer prefilled rather than writing anything: both
 * answers come from the user, so there is nothing to do until that panel
 * resolves. Single-entity only, like creating one. It opens the same editor a
 * row click does, through {@link openReminderEditorForEntity}.
 */
export const makeEditReminderAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    ENABLE_REMINDERS() && entity.type === 'reminder';

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    // Re-checked rather than assumed: a stale command-menu entry could
    // otherwise still fire against a row that has since changed.
    if (!entity || entity.type !== 'reminder' || !canExecute(entity)) return;

    openReminderEditorForEntity(entity);
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are.
    execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
