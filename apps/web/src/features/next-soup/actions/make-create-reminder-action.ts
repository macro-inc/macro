import { openReminderComposer } from '@app/features/reminders/reminder-composer';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import { reminderTarget } from '@queries/reminders/reminders';
import type { EntityActionListState } from './entity-action-context';
import type { makeMarkDoneAction } from './make-mark-done-action';

/**
 * The list the action was driven from, when it was driven from one.
 *
 * `advances` is the caller's answer to whether marking the row done should move
 * the list on to the next row — the same question its own "Mark done" answers,
 * and not one this module can work out from the list alone: a soup state is
 * per-split and its predicates say what the split is showing now, not whether
 * done is a thing this list does.
 */
export type ReminderCreatedList = {
  soup: EntityActionListState;
  advances: boolean;
};

/** What the invoking surface does with its row once the reminder exists. */
export type ReminderCreatedHandler = (
  entity: EntityData,
  list?: ReminderCreatedList
) => void | Promise<void>;

type MakeCreateReminderOptions = {
  onCreated?: ReminderCreatedHandler;
};

/**
 * Set a reminder about an entity.
 *
 * `execute` opens the composer rather than writing anything: the description
 * and the date both come from the user, so there is nothing to do until that
 * modal resolves. Single-entity only — a reminder points at one thing.
 *
 * `onCreated` is what happens on the far side of that modal, once the reminder
 * has actually been created. Every soup surface passes
 * `markReminderTargetDone`.
 *
 * `canExecute` carries the `ENABLE_REMINDERS` gate, which is what every surface
 * (hotkeys, both soup menus, the block ⋯ menu) checks before offering the
 * action — so the flag reaches all of them from here. `execute` re-checks it,
 * since a stale command-menu entry could otherwise still fire.
 */
export const makeCreateReminderAction = (
  options?: MakeCreateReminderOptions
) => {
  const canExecute = (entity: EntityData): boolean =>
    isFeatureEnabled(enableReminders) && reminderTarget(entity) !== undefined;

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    openReminderComposer(entity, {
      onCreated: () => options?.onCreated?.(entity),
    });
  };

  const executeWithSoup = async (
    entities: EntityData[],
    soup: EntityActionListState,
    /** Whether the list moves on once the row is marked done. */
    opts: { advances: boolean }
  ) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are until the reminder exists — `onCreated` is what moves
    // them, by way of marking the row done.
    openReminderComposer(entity, {
      onCreated: () =>
        options?.onCreated?.(entity, { soup, advances: opts.advances }),
    });
  };

  return { canExecute, execute, executeWithSoup };
};

type MarkDoneAction = Pick<
  ReturnType<typeof makeMarkDoneAction>,
  'canExecute' | 'execute' | 'executeWithSoup'
>;

/**
 * Mark the reminder's target done, which is what setting a reminder is for:
 * the reminder brings the thing back, so it leaves the list now.
 *
 * Entity types with no done state of their own — a call, a CRM company or
 * contact — are skipped rather than handled; `markDone.canExecute` is the
 * app's answer for which those are, and it is the same gate the "Mark Done"
 * menu entry uses.
 *
 * On a list that moves on — the inbox, mail, the reminders views, and the same
 * lists seen from a block being triaged out of one — this runs mark-done's own
 * soup path, so a reminder leaves the selection, and any attached split, on the
 * next row exactly as "Mark done" does. A list that has no notion of done
 * (Documents, a folder) says so, and the row is marked where it sits.
 *
 * Silent: the composer's "Reminder set for …" toast is the feedback, and a
 * second "Marked as done" on top of it says the same thing twice. The
 * mark-done still lands on the undo stack, so cmd+Z reverses it.
 */
export const markReminderTargetDone =
  (
    markDone: MarkDoneAction,
    /** Follows the list's focus in an attached split, as mark-done's own
     *  entry points do. */
    onNavigate?: (entity: EntityData) => void
  ): ReminderCreatedHandler =>
  async (entity, list) => {
    if (!markDone.canExecute(entity)) return;

    if (list?.advances) {
      await markDone.executeWithSoup([entity], list.soup, onNavigate, {
        silent: true,
      });
      return;
    }

    await markDone.execute([entity], undefined, { silent: true });
  };
