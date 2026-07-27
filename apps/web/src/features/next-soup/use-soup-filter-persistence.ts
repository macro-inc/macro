import { usePreference } from '@app/preferences/use-preference';

const SOUP_FILTER_PERSISTENCE_STORAGE_KEY =
  'macro:pref:soup:filter-persistence';

/** Whether soup filters should persist across reloads on this device. */
export function useSoupFilterPersistence() {
  return usePreference(SOUP_FILTER_PERSISTENCE_STORAGE_KEY, { default: false });
}
