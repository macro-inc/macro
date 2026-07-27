import { makePersisted } from '@solid-primitives/storage';
import { createSignal, type Signal } from 'solid-js';

const SOUP_FILTER_PERSISTENCE_STORAGE_KEY =
  'macro:pref:soup:filter-persistence';

let soupFilterPersistence: Signal<boolean> | undefined;

/** Whether soup filters should persist across reloads on this device. */
export function useSoupFilterPersistence(): Signal<boolean> {
  if (!soupFilterPersistence) {
    const [shouldPersist, setShouldPersist] = makePersisted(
      createSignal(false),
      { name: SOUP_FILTER_PERSISTENCE_STORAGE_KEY }
    );
    soupFilterPersistence = [shouldPersist, setShouldPersist];
  }

  return soupFilterPersistence;
}
