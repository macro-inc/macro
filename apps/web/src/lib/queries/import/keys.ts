import { createQueryKeys } from '@lukemorales/query-key-factory';

export const importKeys = createQueryKeys('import', {
  /** Discovery runs plus visible ledger rows. */
  state: null,
  /** The Notion workspace import report. */
  notion: null,
});
