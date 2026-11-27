import { ENTITY_NAMES } from './entities';

const DATABASES = [
  {
    id: 'database-feedback',
    data: { name: ENTITY_NAMES['database-feedback'] },
  },
];

/** The databases Macro knows the owner has. */
export function useQuickAccess() {
  return { useList: () => ({ items: () => DATABASES }) };
}
