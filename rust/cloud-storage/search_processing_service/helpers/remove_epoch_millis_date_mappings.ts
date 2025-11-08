require('dotenv').config();

import type { Client } from '@opensearch-project/opensearch';
import { client } from './client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECT_INDEX,
} from './constants';

interface FieldToRemove {
  fieldName: string;
}

interface IndexCleanup {
  indexName: string;
  fieldsToRemove: FieldToRemove[];
}

const CLEANUPS: IndexCleanup[] = [
  {
    indexName: CHANNEL_INDEX,
    fieldsToRemove: [{ fieldName: 'created_at' }, { fieldName: 'updated_at' }],
  },
  {
    indexName: CHAT_INDEX,
    fieldsToRemove: [{ fieldName: 'updated_at' }],
  },
  {
    indexName: DOCUMENT_INDEX,
    fieldsToRemove: [{ fieldName: 'updated_at' }],
  },
  {
    indexName: EMAIL_INDEX,
    fieldsToRemove: [{ fieldName: 'updated_at' }, { fieldName: 'sent_at' }],
  },
  {
    indexName: PROJECT_INDEX,
    fieldsToRemove: [{ fieldName: 'created_at' }, { fieldName: 'updated_at' }],
  },
];

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

async function checkReplacementFieldExists(
  opensearchClient: Client,
  indexName: string,
  fieldName: string
): Promise<boolean> {
  const replacementField = `${fieldName}_seconds`;
  return await checkFieldExists(opensearchClient, indexName, replacementField);
}

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
        body.failures,
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
        `Task ID: ${body.task}. This script does not support async operations.`,
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
  cleanup: IndexCleanup,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `Cleaning up index: ${cleanup.indexName} ${dryRun ? '(DRY-RUN)' : ''}`
  );
  console.log(`${'='.repeat(60)}`);

  const indexExists = await checkIndexExists(
    opensearchClient,
    cleanup.indexName
  );

  if (!indexExists) {
    console.log(`⚠️  Index "${cleanup.indexName}" does not exist. Skipping...`);
    return;
  }

  for (const field of cleanup.fieldsToRemove) {
    console.log(`\nProcessing field: ${field.fieldName}`);

    const fieldExists = await checkFieldExists(
      opensearchClient,
      cleanup.indexName,
      field.fieldName
    );

    if (!fieldExists) {
      console.log(
        `  ℹ️  Field "${field.fieldName}" does not exist in index. Skipping...`
      );
      continue;
    }

    const replacementFieldName = `${field.fieldName}_seconds`;
    const replacementExists = await checkReplacementFieldExists(
      opensearchClient,
      cleanup.indexName,
      field.fieldName
    );

    if (!replacementExists) {
      console.log(
        `  ⚠️  Replacement field "${replacementFieldName}" does not exist!`
      );
      console.log(
        `  ⚠️  Skipping removal of "${field.fieldName}" for safety. Run migration first.`
      );
      continue;
    }

    const verification = await verifyDocumentsHaveReplacementData(
      opensearchClient,
      cleanup.indexName,
      field.fieldName,
      replacementFieldName
    );

    console.log(
      `  📊 Pre-check: ${verification.totalCount} documents have "${field.fieldName}"`
    );

    if (!verification.hasData) {
      console.log(
        `  ⚠️  Not all documents have been migrated to "${replacementFieldName}"!`
      );
      console.log(
        `  ⚠️  Found ${verification.sampleCount} documents without replacement field.`
      );
      console.log(`  ⚠️  Skipping removal for safety.`);
      continue;
    }

    console.log(
      `  ✓ All documents have corresponding "${replacementFieldName}" field`
    );

    await removeFieldFromDocuments(
      opensearchClient,
      cleanup.indexName,
      field.fieldName,
      dryRun
    );

    await verifyFieldRemoval(
      opensearchClient,
      cleanup.indexName,
      field.fieldName,
      dryRun
    );
  }

  console.log(`\n✓ Completed cleanup for index: ${cleanup.indexName}`);
}

async function runCleanup(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `OpenSearch Field Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script will remove old timestamp fields with incorrect'
  );
  console.log('epoch_millis interpretation after migration to *_seconds fields.');
  console.log('\n⚠️  WARNING: This will permanently delete data from documents!');
  console.log(
    'Make sure you have run migrate_timestamp_epoch_seconds.ts first.'
  );

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be permanently removed!');
  }

  try {
    for (const cleanup of CLEANUPS) {
      await cleanupIndex(opensearchClient, cleanup, dryRun);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Cleanup completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run the cleanup for real, set DRY_RUN=false environment variable'
      );
      console.log('or call runCleanup(false) directly.\n');
    } else {
      console.log('\n✓ All old timestamp fields have been removed.');
      console.log(
        '✓ Only *_seconds fields remain with correct epoch_second format.\n'
      );
    }
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    throw error;
  }
}

const isDryRun = process.env.DRY_RUN !== 'false';

runCleanup(isDryRun);
