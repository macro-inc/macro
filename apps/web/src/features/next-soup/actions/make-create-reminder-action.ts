import { openReminderComposer } from '@app/features/reminders/reminder-composer';
import { ENABLE_REMINDERS } from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import { reminderTarget } from '@queries/reminders/reminders';
import type { SoupState } from '../create-soup-state';
import { soupHidesDoneRows } from '../hides-done';
import type { makeMarkDoneAction } from './make-mark-done-action';

/**
 * What the invoking surface does with its row once the reminder exists.
 *
 * `soup` is passed when the action was driven from a list, so the handler can
 * move focus off a row that is about to leave it.
 */
export type ReminderCreatedHandler = (
  entity: EntityData,
  soup?: SoupState
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
    ENABLE_REMINDERS() && reminderTarget(entity) !== undefined;

  const execute = (entities: EntityData[]) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    openReminderComposer(entity, {
      onCreated: () => options?.onCreated?.(entity),
    });
  };

  const executeWithSoup = async (entities: EntityData[], soup: SoupState) => {
    const [entity] = entities;
    if (!entity || !canExecute(entity)) return;
    // Opening the composer doesn't change the list, so selection and focus are
    // left where they are until the reminder exists — `onCreated` is what moves
    // them, by way of marking the row done.
    openReminderComposer(entity, {
      onCreated: () => options?.onCreated?.(entity, soup),
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
 * The soup path is taken only for a list that hides done rows, since that is
 * what makes moving focus off the row correct. Setting a reminder from a list
 * that keeps it — Documents, a folder — marks it done where it sits instead of
 * advancing the selection, and its preview, onto the next row.
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
  async (entity, soup) => {
    if (!markDone.canExecute(entity)) return;

    if (soup && soupHidesDoneRows(soup)) {
      await markDone.executeWithSoup([entity], soup, onNavigate, {
        silent: true,
      });
      return;
    }

    await markDone.execute([entity], undefined, { silent: true });
  };
