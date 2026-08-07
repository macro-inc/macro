import { openReminderComposer } from '@app/features/reminders/reminder-composer';
import { ENABLE_REMINDERS } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import { reminderTarget } from '@queries/reminders/reminders';
import type { SoupState } from '../create-soup-state';

/**
 * Set a reminder about an entity.
 *
 * `execute` opens the composer rather than writing anything: the description
 * and the date both come from the user, so there is nothing to do until that
 * modal resolves. Single-entity only — a reminder points at one thing.
 *
 * `canExecute` carries the `ENABLE_REMINDERS` gate, which is what every surface
 * (hotkeys, both soup menus, the block ⋯ menu) checks before offering the
 * action — so the flag reaches all of them from here. `execute` re-checks it,
 * since a stale command-menu entry could otherwise still fire.
 */
export const makeCreateReminderAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    ENABLE_REMINDERS() && reminderTarget(entity) !== undefined;

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    openReminderComposer(entity);
  };

  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are.
    execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};
