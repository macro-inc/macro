import type { ImportEntity, ImportSource } from '@queries/import';

/*
 * Pure selection logic for the /setup import panel: which sources exist,
 * and how the per-source skip set maps onto the accept/decline id lists
 * `POST /import/run` takes. No Solid primitives here.
 */

/** Per-source skip set: sections import by default; `true` skips one. */
export type SkippedSources = Partial<Record<ImportSource, boolean>>;

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

/**
 * Split the user's staged rows into accept/decline id lists from the skip
 * set. What "Continue to Macro" sends to `POST /import/run`.
 */
export function stagedSelection(
  entities: ImportEntity[] | undefined,
  skippedSources: SkippedSources
): { importIds: string[]; discardIds: string[] } {
  const staged = (entities ?? []).filter(
    (entity) => entity.status === 'staged'
  );
  return {
    importIds: staged
      .filter((entity) => !skippedSources[entity.source])
      .map((entity) => entity.id),
    discardIds: staged
      .filter((entity) => skippedSources[entity.source])
      .map((entity) => entity.id),
  };
}
