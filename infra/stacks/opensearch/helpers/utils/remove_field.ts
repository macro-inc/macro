import type { Client } from '@opensearch-project/opensearch';
import { checkIndexExists } from './check_index_exists';

/**
 * Checks if a field exists in an index.
 * @param opensearchClient The OpenSearch client.
 * @param indexName The name of the index.
 * @param fieldName The name of the field.
 * @returns Whether the field exists.
 */
async function checkFieldExists(
  opensearchClient: Client,
  indexName: string,
  fieldName: string
): Promise<boolean> {
  const response = await opensearchClient.indices.getMapping({
    index: indexName,
  });

  const mappings = response.body[indexName]?.mappings?.properties;
  return !!mappings && mappings[fieldName] !== undefined;
}

/**
 * Verifies that all documents have a replacement field.
 * @param opensearchClient The OpenSearch client.
 * @param indexName The name of the index.
 * @param oldField The name of the field to check.
 * @param newField The name of the replacement field.
 * @returns Whether all documents have the replacement field.
 */
async function verifyDocumentsHaveReplacementData(
  opensearchClient: Client,
  indexName: string,
  oldField: string,
  newField: string
): Promise<{ hasData: boolean; sampleCount: number; totalCount: number }> {
  const countResponse = await opensearchClient.count({
    index: indexName,
    body: {
      query: {
        exists: {
          field: oldField,
        },
      },
    },
  });

  const totalWithOldField = countResponse.body.count;

  const newFieldCountResponse = await opensearchClient.count({
    index: indexName,
    body: {
      query: {
        exists: {
          field: newField,
        },
      },
    },
  });

  const totalWithNewField = newFieldCountResponse.body.count;

  const sampleResponse = await opensearchClient.search({
    index: indexName,
    body: {
      size: 5,
      query: {
        bool: {
          must: [{ exists: { field: oldField } }],
          must_not: [{ exists: { field: newField } }],
        },
      },
    },
  });

  const docsWithoutMigration = sampleResponse.body.hits.hits;

  return {
    hasData: totalWithNewField >= totalWithOldField,
    sampleCount: docsWithoutMigration.length,
    totalCount: totalWithOldField,
  };
}

/**
 * Removes a field from all documents in an index.
 * This should only be run if you are sure the field is no longer needed.
 * @param opensearchClient The OpenSearch client.
 * @param indexName The name of the index.
 * @param fieldName The name of the field to remove.
 * @param dryRun Whether to run the script in dry run mode.
 * @returns The number of documents updated.
 */
async function removeFieldFromDocuments(
  opensearchClient: Client,
  indexName: string,
  fieldName: string,
  dryRun: boolean
): Promise<number> {
  const script = {
    source: `if (ctx._source.containsKey('${fieldName}')) { ctx._source.remove('${fieldName}'); }`,
    lang: 'painless',
  };

  console.log(
    `  ${dryRun ? '[DRY-RUN] Would remove' : 'Removing'} field "${fieldName}" from all documents in index "${indexName}"`
  );

  if (dryRun) {
    const countResponse = await opensearchClient.count({
      index: indexName,
      body: {
        query: {
          exists: {
            field: fieldName,
          },
        },
      },
    });
    const docCount = countResponse.body.count;
    console.log(
      `  [DRY-RUN] Would update ${docCount} documents to remove field`
    );
    return docCount;
  }

  const response = await opensearchClient.updateByQuery({
    index: indexName,
    body: {
      script,
      query: {
        exists: {
          field: fieldName,
        },
      },
    },
    refresh: true,
  });

  const body = response.body;

  if ('took' in body) {
    if (body.failures && body.failures.length > 0) {
      console.error(
        `  ⚠️  Encountered ${body.failures.length} failures:`,
        body.failures
      );
      throw new Error(`Update by query failed for some documents`);
    }

    const updated = body.updated ?? 0;
    const total = body.total ?? 0;
    console.log(`  ✓ Removed field from ${updated} of ${total} documents`);
    return updated;
  }

  throw new Error(
    `Update by query returned a task ID instead of completing synchronously. ` +
      `Task ID: ${body.task}. This script does not support async operations.`
  );
}

/**
 * Verifies that a field has been removed from all documents.
 * @param opensearchClient The OpenSearch client.
 * @param indexName The name of the index.
 * @param fieldName The name of the field to check.
 * @param dryRun Whether to run the script in dry run mode.
 * @returns Whether the field has been removed from all documents.
 */
async function verifyFieldRemoval(
  opensearchClient: Client,
  indexName: string,
  fieldName: string,
  dryRun: boolean
): Promise<void> {
  console.log(
    `  ${dryRun ? '[DRY-RUN] Would verify' : 'Verifying'} removal of field "${fieldName}" from index "${indexName}"`
  );

  if (dryRun) {
    console.log(`[DRY-RUN] Would check that no documents contain the field`);
    return;
  }

  const countResponse = await opensearchClient.count({
    index: indexName,
    body: {
      query: {
        exists: {
          field: fieldName,
        },
      },
    },
  });

  const remainingDocs = countResponse.body.count;

  if (remainingDocs > 0) {
    console.log(
      `⚠️ Warning: ${remainingDocs} documents still contain field "${fieldName}"`
    );
  } else {
    console.log(`✓ Confirmed: No documents contain field "${fieldName}"`);
  }
}

type RemoveFieldOptions = {
  // the index to remove the field from
  indexName: string;
  // the name of the field to remove
  fieldNameToRemove: string;
  // If provided, this will check that the field you are removing has been successfully migrated to this field
  replacementFieldName?: string;
};

/**
 * Attempts to remove a field from an index.
 * This will firt validate that a replacement field exists and all documents have the replacement field.
 */
export async function removeField(
  opensearchClient: Client,
  dryRun: boolean,
  options: RemoveFieldOptions
): Promise<void> {
  const { indexName, fieldNameToRemove, replacementFieldName } = options;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Cleaning up index: ${indexName} ${dryRun ? '(DRY-RUN)' : ''}`);
  console.log(`${'='.repeat(60)}`);

  const indexExists = await checkIndexExists(opensearchClient, indexName);

  if (!indexExists) {
    console.log(`⚠️  Index "${indexName}" does not exist. Skipping...`);
    return;
  }

  console.log(`\nProcessing field: ${fieldNameToRemove}`);

  const fieldExists = await checkFieldExists(
    opensearchClient,
    indexName,
    fieldNameToRemove
  );

  if (!fieldExists) {
    console.log(
      `Field "${fieldNameToRemove}" does not exist in index. Skipping...`
    );
    return;
  }

  if (replacementFieldName) {
    const replacementExists = await checkFieldExists(
      opensearchClient,
      indexName,
      replacementFieldName
    );

    if (!replacementExists) {
      console.log(
        `⚠️ Replacement field "${replacementFieldName}" does not exist!`
      );
      console.log(
        `⚠️ Skipping removal of "${fieldNameToRemove}" for safety. Run migration first.`
      );
      return;
    }
    const verification = await verifyDocumentsHaveReplacementData(
      opensearchClient,
      indexName,
      fieldNameToRemove,
      replacementFieldName
    );

    if (!verification.hasData) {
      console.log(
        `⚠️ Not all documents have been migrated to "${replacementFieldName}"!`
      );
      console.log(
        `⚠️ Found ${verification.sampleCount} documents without replacement field.`
      );
      console.log(`⚠️ Skipping removal for safety.`);
      return;
    }

    console.log(
      `✓ All documents have corresponding "${replacementFieldName}" field`
    );
  }

  await removeFieldFromDocuments(
    opensearchClient,
    indexName,
    fieldNameToRemove,
    dryRun
  );

  await verifyFieldRemoval(
    opensearchClient,
    indexName,
    fieldNameToRemove,
    dryRun
  );

  console.log(`\n✓ Completed cleanup for index: ${indexName}`);
}
