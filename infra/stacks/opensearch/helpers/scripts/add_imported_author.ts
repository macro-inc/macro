import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import { CHANNELS_ALIAS, IS_DRY_RUN } from '../constants';

export const IMPORTED_AUTHOR_MAPPING = {
  type: 'text' as const,
  analyzer: 'content_text',
  // Explicitly clear existing copy_to mappings; omitting it preserves them.
  // OpenSearch otherwise loads the author instead of the body for highlights.
  copy_to: [] as string[],
};

/**
 * Add the field to the live alias (including legacy physical `channels` indices).
 * Deploy direct imported_author search before running this on an existing index.
 * Clearing copy_to restores body highlights immediately, without a reindex.
 * If adding the field for the first time, backfill affected channels: mapping
 * updates do not index fields already present in old documents' _source.
 * No index creation, alias swap, or message-content rewrite is performed.
 * From helpers/: DRY_RUN=false bun scripts/add_imported_author.ts
 * Optional INDEX targets a physical backfill index instead of the live alias.
 */
export async function addImportedAuthor(
  opensearchClient: Pick<Client, 'indices'>,
  dryRun: boolean,
  index: string = CHANNELS_ALIAS
): Promise<void> {
  const exists = await opensearchClient.indices.exists({ index });
  if (!exists.body) {
    throw new Error(`Channel index "${index}" does not exist`);
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would add imported_author to ${index}`);
    return;
  }

  const response = await opensearchClient.indices.putMapping({
    index,
    body: { properties: { imported_author: IMPORTED_AUTHOR_MAPPING } },
  });
  if (!response.body.acknowledged) {
    throw new Error(`Failed to add imported_author mapping to ${index}`);
  }
  console.log(`${index}: imported_author mapped without copy_to`);
}

if (import.meta.main) {
  await addImportedAuthor(client(), IS_DRY_RUN, process.env.INDEX);
}
