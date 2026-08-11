import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { batch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

export const [reminderComposerOpen, setReminderComposerOpen] =
  createControlledOpenSignal(false, { id: 'reminder-create' });

interface ReminderComposerState {
  /** The entity the reminder is about. */
  entity?: EntityData;
}

const [state, setState] = createStore<ReminderComposerState>({
  entity: undefined,
});

/**
 * Open the composer for an entity.
 *
 * There is only one thing left to ask: when. The entity is whatever the command
 * was invoked on and the description is derived from it, so the composer opens
 * straight onto the date list.
 */
export function openReminderComposer(entity: EntityData) {
  // Batched so the modal's open-keyed effect sees this entity rather than the
  // previous one.
  batch(() => {
    setState(reconcile({ entity }));
    setReminderComposerOpen(true);
  });
}

export function closeReminderComposer() {
  batch(() => {
    setReminderComposerOpen(false);
    setState(reconcile({ entity: undefined }));
  });
}

export const reminderComposerState = state;
