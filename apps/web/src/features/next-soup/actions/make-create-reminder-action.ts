import { openReminderComposer } from '@app/features/reminders/reminder-composer';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import type {
  EntityActionListState,
  EntityActionNavigationHandler,
} from './entity-action-context';

type MakeCreateReminderOptions = {
  onEmailSaved?: () => void | Promise<void>;
};

export const makeCreateReminderAction = (
  options?: MakeCreateReminderOptions
) => {
  const canExecute = (
    entity: EntityData
  ): entity is Extract<EntityData, { type: 'email' }> =>
    isFeatureEnabled(enableReminders) && entity.type === 'email';

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    openReminderComposer(entity, {
      onCreated: options?.onEmailSaved,
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState,
    /** Whether the list moves on once the email is snoozed. */
    opts: {
      advances: boolean;
      onNavigate?: EntityActionNavigationHandler;
    }
  ) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    openReminderComposer(entity, {
      onCreated: async () => {
        // A hosted email view owns pagination and its navigation history.
        if (options?.onEmailSaved) {
          await options.onEmailSaved();
          return;
        }
        if (opts.advances) {
          const next = [1, -1]
            .map((direction) =>
              soup.navigate.peekOffset(direction, {
                wrapNavigation: false,
                skipGroupHeaders: true,
                skipLoadMore: true,
              })
            )
            .find(
              (candidate) =>
                candidate && candidate.row.original.id !== entity.id
            )?.row;
          soup.selection.clear();
          soup.focus.set(next?.id);
          opts.onNavigate?.({
            actionId: 'create-reminder',
            entity: next?.original,
          });
        }
      },
    });
  };

  return { canExecute, execute, executeWithSoup };
};
