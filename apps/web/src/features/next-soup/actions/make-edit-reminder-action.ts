import { globalSplitManager } from '@app/signal/splitLayout';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import { openEntityInSplitFromUnifiedList } from '../utils';
import type { EntityActionListState } from './entity-action-context';

/**
 * Edit an existing reminder — its description, its schedule, or both.
 *
 * Opens the reminder's editor the same way a row click does: through
 * {@link openEntityInSplitFromUnifiedList}, which resolves the reminder to its
 * `reminder-view` split and previews it into the Viewer when driven from a
 * Preview Pair. Single-entity only, like creating one.
 */
export const makeEditReminderAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    isFeatureEnabled(enableReminders) && entity.type === 'reminder';

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    // Re-checked rather than assumed: a stale command-menu entry could
    // otherwise still fire against a row that has since changed.
    if (!entity || entity.type !== 'reminder' || !canExecute(entity)) return;

    openEntityInSplitFromUnifiedList(entity, {
      splitHandle: globalSplitManager()?.activeSplit(),
      referredFrom: null,
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    // Opening the editor doesn't change the list, so selection and focus are
    // left where they are.
    execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
