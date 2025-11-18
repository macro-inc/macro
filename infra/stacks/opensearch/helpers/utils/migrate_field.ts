import type { Client } from '@opensearch-project/opensearch';
import { checkIndexExists } from './check_index_exists';
import { copyFieldData, verifyFieldCopy } from './copy_field';

export type FieldToMigrate = {
  oldField: string;
  newField: string;
};

export type IndexMigration = {
  indexName: string;
  fields: FieldToMigrate[];
};

/**
 * This function migrates a field from one index to another.
 * @param opensearchClient An instance of the OpenSearch client.
 * @param migration An object containing the index name and the field to migrate.
 * @param dryRun A boolean indicating whether to perform a dry run.
 * @returns A Promise that resolves when the field has been migrated.
 */
export async function migrateIndex(
  opensearchClient: Client,
  migration: IndexMigration,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `Migrating index: ${migration.indexName} ${dryRun ? '(DRY-RUN)' : ''}`
  );
  console.log(`${'='.repeat(60)}`);

  const indexExists = await checkIndexExists(
    opensearchClient,
    migration.indexName
  );

  if (!indexExists) {
    console.log(
      `⚠️  Index "${migration.indexName}" does not exist. Skipping...`
    );
    return;
  }

  for (const field of migration.fields) {
    console.log(`\nProcessing field: ${field.oldField}`);

    await copyFieldData(
      opensearchClient,
      migration.indexName,
      field.oldField,
      field.newField,
      dryRun
    );

    await verifyFieldCopy(
      opensearchClient,
      migration.indexName,
      field.oldField,
      field.newField,
      dryRun
    );
  }

  console.log(`\n✓ Completed migration for index: ${migration.indexName}`);
}
