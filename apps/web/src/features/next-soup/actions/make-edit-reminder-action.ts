import { openReminderDetail } from '@app/features/reminders/reminder-navigation';
import { globalSplitManager } from '@app/signal/splitLayout';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type { EntityActionListState } from './entity-action-context';

/** Edit scheduling without following an attached reminder to its source. */
export const makeEditReminderAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    isFeatureEnabled(enableReminders) && entity.type === 'reminder';

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    // Re-checked rather than assumed: a stale command-menu entry could
    // otherwise still fire against a row that has since changed.
    if (!entity || entity.type !== 'reminder' || !canExecute(entity)) return;

    openReminderDetail(entity.id, {
      handle: globalSplitManager()?.activeSplit(),
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
