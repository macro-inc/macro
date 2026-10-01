import { clearPressedKeys } from '@core/hotkey/state';
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
  choosing?: boolean;
}

/** What the surface that opened the composer does once the reminder exists. */
export type ReminderCreatedHandler = () => void | Promise<void>;

/**
 * Held outside the store: nothing renders it, and a function in a store is a
 * footgun — the setters read one as an updater.
 */
let createdHandler: ReminderCreatedHandler | undefined;

/**
 * Hand the pending handler to the caller and forget it after create succeeds.
 * A rejected create leaves it here so the preserved draft can be retried and
 * still perform the invoking surface's follow-up exactly once.
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
  standalone: undefined,
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
    setState(reconcile({ entity, standalone: undefined }));
    setReminderComposerOpen(true);
  });
}

/**
 * Open reminder creation without a preselected source. The picker offers an
 * entity association or a freeform reminder with a required description.
 */
export function openStandaloneReminderComposer(options?: {
  onCreated?: ReminderCreatedHandler;
}) {
  createdHandler = options?.onCreated;
  batch(() => {
    setState(reconcile({ entity: undefined, choosing: true }));
    setReminderComposerOpen(true);
  });
}

/** Switch targets within the open composer, retaining the invoking callback. */
export function chooseReminderTarget(entity?: EntityData) {
  setState(reconcile(entity ? { entity } : { standalone: true }));
}

export function showReminderEntityPicker() {
  // A different target must never run the original row’s archive/navigation callback.
  createdHandler = undefined;
  setState(reconcile({ choosing: true }));
}

export function closeReminderComposer() {
  // Escape dismisses the dialog outside the hotkey command runner. Its keyup
  // can be lost during focus restoration, so don't carry held keys into H.
  if (reminderComposerOpen()) clearPressedKeys();
  createdHandler = undefined;
  batch(() => {
    setReminderComposerOpen(false);
    setState(reconcile({ entity: undefined, standalone: undefined }));
  });
}

export const reminderComposerState = state;
