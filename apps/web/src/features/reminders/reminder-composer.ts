import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { batch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

export const [reminderComposerOpen, setReminderComposerOpen] =
  createControlledOpenSignal(false, { id: 'reminder-create' });

/**
 * The reminder being edited, as its row already knows it.
 *
 * Taken from the list rather than re-fetched: a soup row carries the
 * description and `nextRunAt` already, so opening the editor costs no request
 * and cannot show a spinner over a value the user is looking at.
 */
export interface ReminderDraft {
  /** The reminder's id, which the patch is addressed to. */
  id: string;
  /** Its current description, prefilled into the first step. */
  description: string;
  /** Its current firing, offered as "Keep current time". */
  remindAt: Date;
  /** Whether the owner has marked it done, which a reschedule has to undo. */
  completed: boolean;
  /**
   * What a blank description falls back to — the name of the entity this
   * reminder is about, as creating one would have derived it.
   *
   * Absent for a standalone reminder, and for a reference whose name is not
   * cached; blanking the field then leaves the description alone.
   */
  fallbackDescription?: string;
}

interface ReminderComposerState {
  /** The entity a new reminder is about. Absent when editing. */
  entity?: EntityData;
  /** The reminder being edited. Absent when creating. */
  editing?: ReminderDraft;
}

const [state, setState] = createStore<ReminderComposerState>({
  entity: undefined,
  editing: undefined,
});

/**
 * Open the composer to create a reminder about an entity.
 *
 * There is only one thing left to ask: when. The entity is whatever the command
 * was invoked on and the description is derived from it, so the composer opens
 * straight onto the date list.
 */
export function openReminderComposer(entity: EntityData) {
  // Batched so the modal's open-keyed effect sees this entity rather than the
  // previous one.
  batch(() => {
    setState(reconcile({ entity, editing: undefined }));
    setReminderComposerOpen(true);
  });
}

/**
 * Open the composer to edit an existing reminder.
 *
 * The same two steps as creating one, prefilled: the description step starts
 * from what the reminder says, and the date step leads with keeping its current
 * time so a rename does not force a new date to be picked.
 */
export function openReminderEditor(reminder: ReminderDraft) {
  batch(() => {
    setState(reconcile({ entity: undefined, editing: reminder }));
    setReminderComposerOpen(true);
  });
}

export function closeReminderComposer() {
  batch(() => {
    setReminderComposerOpen(false);
    setState(reconcile({ entity: undefined, editing: undefined }));
  });
}

export const reminderComposerState = state;
