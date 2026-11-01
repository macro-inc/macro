import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { type EntityData, isCrmContactEntity } from '@entity/types/entity';
import { createSignal } from 'solid-js';
import type { Person } from './context/sequences-context';
import { SEQUENCE_LIMITS } from './core/sequence';

// Selection actions open the one dialog the app shell mounts on first use.
const [people, setPeople] = createSignal<readonly Person[]>();
const lock = useFocusLock('add-to-sequence');

/** Selected People fit one enrollment batch. */
export function canAddToSequence(entities: readonly EntityData[]) {
  return (
    entities.length > 0 &&
    entities.length <= SEQUENCE_LIMITS.contacts &&
    entities.every(isCrmContactEntity)
  );
}

export function openAddToSequence(entities: readonly EntityData[]) {
  if (!canAddToSequence(entities)) return;
  lock.acquire();
  setPeople(
    entities.filter(isCrmContactEntity).map((entity) => ({
      id: entity.id,
      name: entity.name,
      email: entity.email,
    }))
  );
}

export const addToSequenceDialog = {
  people,
  close() {
    lock.release();
    setPeople(undefined);
  },
};
