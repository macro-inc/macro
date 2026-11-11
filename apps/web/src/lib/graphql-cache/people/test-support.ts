import type { PeopleCache, PeopleTransport } from './host';
import { CONTACT_SYNC_UNSUPPORTED } from './sync-protocol';

/** Explicit older-host capability for fixtures that do not exercise backfill. */
export const unsupportedContactSync: Pick<
  PeopleCache,
  'snapshot' | 'reconcile'
> = {
  snapshot: async () => ({ kind: 'unsupported' }),
  reconcile: async () => {
    throw new Error(CONTACT_SYNC_UNSUPPORTED);
  },
};

/** Unimplemented capabilities stay explicit when a fixture supplies only sync. */
export const unsupportedPeopleTransport: PeopleTransport = {
  ...unsupportedContactSync,
  context: async () => ({ kind: 'unsupported' }),
  search: async () => ({ kind: 'unsupported' }),
  readSql: async () => ({ kind: 'unsupported' }),
  resolveReferences: async () => ({ kind: 'unsupported' }),
  update: async () => {
    throw new Error('Unsupported context write');
  },
};
