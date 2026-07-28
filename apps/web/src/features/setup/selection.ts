import type { ImportSource } from '@queries/import';

/*
 * Import-source display metadata shared by onboarding summary cards.
 */

/** Display order, connector identity, and item noun for one source. */
export interface SourceSection {
  source: ImportSource;
  serverName: string;
  /** What the items are called in blurbs ("we found 16 documents…"). */
  noun: string;
}

/** All import sources, in display order. */
export const SOURCE_SECTIONS: SourceSection[] = [
  { source: 'linear', serverName: 'Linear', noun: 'issues' },
  { source: 'notion', serverName: 'Notion', noun: 'documents' },
  { source: 'slack', serverName: 'Slack', noun: 'channels' },
];
