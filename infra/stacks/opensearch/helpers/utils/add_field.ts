import type { Client } from '@opensearch-project/opensearch';
import type { Indices_PutMapping_RequestBody } from '@opensearch-project/opensearch/api/index.js';

/**
 * This function adds a field to an index.
 * @param opensearchClient An instance of the OpenSearch client.
 * @param indexName The name of the index to add the field to.
 * @param field The field to add to the index.
 * @param dryRun A boolean indicating whether to perform a dry run.
 * @returns A Promise that resolves when the field has been added.
 */
export async function addFieldToIndex(
  opensearchClient: Client,
  indexName: string,
  field: Indices_PutMapping_RequestBody,
  dryRun: boolean
): Promise<void> {
  console.log(
    `${dryRun ? '[DRY-RUN] Would add' : 'Adding'} field "${field}" to index "${indexName}"`
  );

  if (!dryRun) {
    const response = await opensearchClient.indices.putMapping({
      index: indexName,
      body: field,
    });

    if (!response.body.acknowledged) {
      throw new Error(
        `Failed to add mapping for field "${field}" in index "${indexName}"`
      );
    }
    console.log(`✓ Successfully added field "${field}"`);
  }
}
