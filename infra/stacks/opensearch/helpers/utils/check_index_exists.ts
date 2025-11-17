import type { Client } from '@opensearch-project/opensearch';

/**
 * Checks if an index exists in OpenSearch.
 * @param opensearchClient An instance of the OpenSearch client.
 * @param indexName The name of the index to check.
 * @returns A Promise that resolves to a boolean indicating whether the index exists.
 */
export async function checkIndexExists(
  opensearchClient: Client,
  indexName: string
): Promise<boolean> {
  const response = await opensearchClient.indices.exists({
    index: indexName,
  });
  return response.body;
}
