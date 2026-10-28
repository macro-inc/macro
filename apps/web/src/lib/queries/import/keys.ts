import { createQueryKeys } from '@lukemorales/query-key-factory';

export const importKeys = createQueryKeys('import', {
  /** Discovery runs plus visible ledger rows. */
  state: null,
  /** Report for one reviewed workspace source. */
  workspace: (source: 'notion' | 'linear' | 'jira') => [source],
  /** The Notion workspace import report. */
  notion: null,
});
