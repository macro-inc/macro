require('dotenv').config();

import type { Client } from '@opensearch-project/opensearch';
import { client } from './client';
import { PROJECT_INDEX } from './constants';

const INDEX_NAME = PROJECT_INDEX;
const CLEANUP_FIELD = 'parent_project_id';

async function checkIndexExists(
  opensearchClient: Client,
  indexName: string
): Promise<boolean> {
  const response = await opensearchClient.indices.exists({
    index: indexName,
  });
  return response.body;
}

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
    console.log(`  [DRY-RUN] Would check that no documents contain the field`);
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
      `  ⚠️  Warning: ${remainingDocs} documents still contain field "${fieldName}"`
    );
  } else {
    console.log(`  ✓ Confirmed: No documents contain field "${fieldName}"`);
  }
}

async function cleanupIndex(
  opensearchClient: Client,
  indexName: string,
  fieldName: string,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Cleaning up index: ${indexName} ${dryRun ? '(DRY-RUN)' : ''}`);
  console.log(`${'='.repeat(60)}`);

  const indexExists = await checkIndexExists(opensearchClient, indexName);

  if (!indexExists) {
    console.log(`⚠️  Index "${indexName}" does not exist. Skipping...`);
    return;
  }

  console.log(`\nProcessing field: ${fieldName}`);

  const fieldExists = await checkFieldExists(
    opensearchClient,
    indexName,
    fieldName
  );

  if (!fieldExists) {
    console.log(
      `  ℹ️  Field "${fieldName}" does not exist in index. Skipping...`
    );
    return;
  }

  await removeFieldFromDocuments(
    opensearchClient,
    indexName,
    fieldName,
    dryRun
  );

  await verifyFieldRemoval(opensearchClient, indexName, fieldName, dryRun);

  console.log(`\n✓ Completed cleanup for index: ${indexName}`);
}

async function runCleanup(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `OpenSearch Field Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script will remove project_parent_id field from project index.'
  );
  console.log(
    '\n⚠️  WARNING: This will permanently delete data from documents!'
  );

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be permanently removed!');
  }

  try {
    await cleanupIndex(opensearchClient, INDEX_NAME, CLEANUP_FIELD, dryRun);

    console.log('\n' + '='.repeat(60));
    console.log('Cleanup completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run the cleanup for real, set DRY_RUN=false environment variable'
      );
      console.log('or call runCleanup(false) directly.\n');
    } else {
      console.log('\n✓ {CLEANUP_FIELD} has been removed.');
    }
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    throw error;
  }
}

const isDryRun = process.env.DRY_RUN !== 'false';

runCleanup(isDryRun);
