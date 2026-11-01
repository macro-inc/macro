import { useFocusLock } from '@core/util/createControlledOpenSignal';
import type { CrmContactEntity, EntityData } from '@entity';
import { createSignal } from 'solid-js';
import type { Person } from './context/sequences-context';
import { SEQUENCE_LIMITS } from './core/sequence';

// Selection actions open the one dialog the app shell mounts on first use.
const [people, setPeople] = createSignal<readonly Person[]>();
const lock = useFocusLock('add-to-sequence');

// Structural, so the app shell's launcher doesn't pull in the entity module.
function isPerson(entity: EntityData): entity is CrmContactEntity {
  return entity.type === 'crm_contact';
}

/** Selected People fit one enrollment batch. */
export function canAddToSequence(entities: readonly EntityData[]) {
  return (
    entities.length > 0 &&
    entities.length <= SEQUENCE_LIMITS.contacts &&
    entities.every(isPerson)
  );
}

export function openAddToSequence(entities: readonly EntityData[]) {
  if (!canAddToSequence(entities)) return;
  lock.acquire();
  setPeople(
    entities.filter(isPerson).map((entity) => ({
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
