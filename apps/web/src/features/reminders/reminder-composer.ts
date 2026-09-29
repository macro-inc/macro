import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { batch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

export const [reminderComposerOpen, setReminderComposerOpen] =
  createControlledOpenSignal(false, { id: 'reminder-create' });

interface ReminderComposerState {
  /** The entity a new reminder is about. Absent for a standalone reminder. */
  entity?: EntityData;
  /**
   * A new reminder about nothing at all.
   *
   * Its own flag rather than the absence of an entity: "no entity" is also how
   * a closed composer looks, so without this the modal cannot tell a standalone
   * reminder from nothing to compose.
   */
  standalone?: boolean;
  /** An existing reminder to edit rather than a new one to create. */
  editingId?: string;
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

const EMPTY_STATE: ReminderComposerState = {
  entity: undefined,
  standalone: undefined,
  editingId: undefined,
};

const [state, setState] = createStore<ReminderComposerState>({
  ...EMPTY_STATE,
});

/**
 * Open the composer to create a reminder about an entity.
 *
 * The composer opens on the form with the entity named at the top; the
 * description is optional and derived from the entity when left blank.
 */
export function openReminderComposer(
  entity: EntityData,
  options?: { onCreated?: ReminderCreatedHandler }
) {
  createdHandler = options?.onCreated;
  // Batched so the modal's open-keyed effect sees this entity rather than the
  // previous one.
  batch(() => {
    setState(reconcile({ ...EMPTY_STATE, entity }));
    setReminderComposerOpen(true);
  });
}

/**
 * Open the composer to create a reminder about nothing.
 *
 * There is no entity to name it after, so its description is the one field it
 * cannot skip — see `resolveStandaloneDescription`.
 */
export function openStandaloneReminderComposer(options?: {
  onCreated?: ReminderCreatedHandler;
}) {
  createdHandler = options?.onCreated;
  batch(() => {
    setState(reconcile({ ...EMPTY_STATE, standalone: true }));
    setReminderComposerOpen(true);
  });
}

/** Open the composer on an existing reminder, saving edits instead of creating. */
export function openReminderEditor(reminderId: string) {
  createdHandler = undefined;
  batch(() => {
    setState(reconcile({ ...EMPTY_STATE, editingId: reminderId }));
    setReminderComposerOpen(true);
  });
}

export function closeReminderComposer() {
  createdHandler = undefined;
  batch(() => {
    setReminderComposerOpen(false);
    setState(reconcile({ ...EMPTY_STATE }));
  });
}

export const reminderComposerState = state;
