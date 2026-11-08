import { useFocusLock } from '@core/util/createControlledOpenSignal';
import {
  type EntityData,
  isCrmCompanyEntity,
  isCrmContactEntity,
} from '@entity/types/entity';
import { createSignal } from 'solid-js';
import type { Person } from './context/sequences-context';
import { SEQUENCE_LIMITS } from './core/sequence';

/** Who to add: chosen people, and companies whose people are all added. */
type AddRequest = { people: readonly Person[]; companyIds: readonly string[] };

// Selection actions open the one dialog the app shell mounts on first use.
const [request, setRequest] = createSignal<AddRequest>();
const lock = useFocusLock('add-to-sequence');

/** Selected people and companies fit one batch. */
export function canAddToSequence(entities: readonly EntityData[]) {
  return (
    entities.length > 0 &&
    entities.length <= SEQUENCE_LIMITS.contacts &&
    entities.every(
      (entity) => isCrmContactEntity(entity) || isCrmCompanyEntity(entity)
    )
  );
}

export function openAddToSequence(entities: readonly EntityData[]) {
  if (!canAddToSequence(entities)) return;
  lock.acquire();
  setRequest({
    people: entities.filter(isCrmContactEntity),
    companyIds: entities.filter(isCrmCompanyEntity).map((entity) => entity.id),
  });
}

export const addToSequenceDialog = {
  request,
  close() {
    lock.release();
    setRequest(undefined);
  },
};
