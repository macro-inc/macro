import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
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
  /** Its next firing, offered as "Keep current time". */
  remindAt: Date;
  /**
   * Its current schedule, which the edit is diffed against.
   *
   * Distinct from `remindAt` because a recurring reminder is not its next
   * firing: two reminders can come due at the same instant and still be
   * different schedules, and only this says which.
   */
  schedule: ReminderSchedule;
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
  /**
   * A new reminder about nothing at all.
   *
   * Its own flag rather than the absence of the other two: "no entity and no
   * draft" is how a closed composer looks, so without this the modal cannot
   * tell a standalone reminder from nothing to compose.
   */
  standalone?: boolean;
}

/** What the surface that opened the composer does once the reminder exists. */
export type ReminderCreatedHandler = () => void | Promise<void>;

/**
 * Held outside the store: nothing renders it, and a function in a store is a
 * footgun — the setters read one as an updater.
 */
let createdHandler: ReminderCreatedHandler | undefined;

/**
 * Hand the pending handler to the caller and forget it.
 *
 * Taken rather than read because the composer closes — and so clears its
 * target — before the create request is awaited.
 */
export function takeReminderCreatedHandler():
  | ReminderCreatedHandler
  | undefined {
  const handler = createdHandler;
  createdHandler = undefined;
  return handler;
}

const [state, setState] = createStore<ReminderComposerState>({
  entity: undefined,
  editing: undefined,
  standalone: undefined,
});

/**
 * Open the composer to create a reminder about an entity.
 *
 * There is only one thing left to ask: when. The entity is whatever the command
 * was invoked on and the description is derived from it, so the composer opens
 * straight onto the date list.
 */
export function openReminderComposer(
  entity: EntityData,
  options?: { onCreated?: ReminderCreatedHandler }
) {
  createdHandler = options?.onCreated;
  // Batched so the modal's open-keyed effect sees this entity rather than the
  // previous one.
  batch(() => {
    setState(reconcile({ entity, editing: undefined, standalone: undefined }));
    setReminderComposerOpen(true);
  });
}

/**
 * Open the composer to create a reminder about nothing.
 *
 * There is no entity to name it after, so the description step it opens on is
 * the one thing it cannot skip — see `resolveStandaloneDescription`.
 */
export function openStandaloneReminderComposer(options?: {
  onCreated?: ReminderCreatedHandler;
}) {
  createdHandler = options?.onCreated;
  batch(() => {
    setState(
      reconcile({ entity: undefined, editing: undefined, standalone: true })
    );
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
  createdHandler = undefined;
  batch(() => {
    setState(
      reconcile({
        entity: undefined,
        editing: reminder,
        standalone: undefined,
      })
    );
    setReminderComposerOpen(true);
  });
}

export function closeReminderComposer() {
  createdHandler = undefined;
  batch(() => {
    setReminderComposerOpen(false);
    setState(
      reconcile({
        entity: undefined,
        editing: undefined,
        standalone: undefined,
      })
    );
  });
}

export const reminderComposerState = state;
