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

interface DateField {
  oldField: string;
  newField: string;
}

interface IndexMigration {
  indexName: string;
  dateFields: DateField[];
}

const MIGRATIONS: IndexMigration[] = [
  {
    indexName: CHANNEL_INDEX,
    dateFields: [
      { oldField: 'created_at', newField: 'created_at_seconds' },
      { oldField: 'updated_at', newField: 'updated_at_seconds' },
    ],
  },
  {
    indexName: CHAT_INDEX,
    dateFields: [{ oldField: 'updated_at', newField: 'updated_at_seconds' }],
  },
  {
    indexName: DOCUMENT_INDEX,
    dateFields: [{ oldField: 'updated_at', newField: 'updated_at_seconds' }],
  },
  {
    indexName: EMAIL_INDEX,
    dateFields: [
      { oldField: 'updated_at', newField: 'updated_at_seconds' },
      { oldField: 'sent_at', newField: 'sent_at_seconds' },
    ],
  },
  {
    indexName: PROJECT_INDEX,
    dateFields: [
      { oldField: 'created_at', newField: 'created_at_seconds' },
      { oldField: 'updated_at', newField: 'updated_at_seconds' },
    ],
  },
];

async function copyFieldData(
  opensearchClient: Client,
  indexName: string,
  oldField: string,
  newField: string,
  dryRun: boolean
): Promise<number> {
  const script = {
    source: `if (ctx._source.containsKey('${oldField}') && ctx._source.${oldField} != null) { ctx._source.${newField} = ctx._source.${oldField}; }`,
    lang: 'painless',
  };

  console.log(
    `  ${dryRun ? '[DRY-RUN] Would copy' : 'Copying'} data from "${oldField}" to "${newField}" in index "${indexName}"`
  );

  if (dryRun) {
    const countResponse = await opensearchClient.count({
      index: indexName,
      body: {
        query: {
          bool: {
            must: [
              { exists: { field: oldField } }
            ],
            must_not: [
              { exists: { field: newField } }
            ]
          },
        },
      },
    });
    const docCount = countResponse.body.count;
    console.log(
      `  [DRY-RUN] Would update ${docCount} documents where ${newField} does not exist`
    );
    return docCount;
  }

  const response = await opensearchClient.updateByQuery({
    index: indexName,
    wait_for_completion: false,
    scroll_size: 5000,        // Larger batches for better performance
    slices: 'auto',           // Enable parallel processing
    refresh: false,           // Don't refresh after each batch
    body: {
      script,
      query: {
        bool: {
          must: [
            { exists: { field: oldField } }
          ],
          must_not: [
            { exists: { field: newField } }
          ]
        },
      },
    },
  });

  const body = response.body;

  if ('task' in body) {
    const taskId = body.task!;
    console.log(`  ⏳ Started async task: ${taskId}`);
    console.log(`  ⏳ Polling for completion...`);

    // Poll for task completion
    let completed = false;
    let taskResponse: any;

    while (!completed) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      taskResponse = await opensearchClient.tasks.get({
        task_id: taskId,
      });

      completed = taskResponse.body.completed;

      if (!completed) {
        const status = taskResponse.body.task?.status;
        if (status) {
          const updated = status.updated ?? 0;
          const total = status.total ?? 0;
          console.log(`  ⏳ Progress: ${updated}/${total} documents processed`);
        }
      }
    }

    const taskResult = taskResponse.body.response;
    if (taskResult.failures && taskResult.failures.length > 0) {
      const versionConflicts = taskResult.failures.filter(
        (f: any) => f.cause?.type === 'version_conflict_engine_exception'
      ).length;
      const otherFailures = taskResult.failures.length - versionConflicts;

      if (versionConflicts > 0) {
        console.log(
          `  ⚠️  ${versionConflicts} version conflicts (expected during active writes, will be caught on next run)`
        );
      }

      if (otherFailures > 0) {
        console.error(
          `  ⚠️  Encountered ${otherFailures} non-version-conflict failures:`,
          taskResult.failures.filter((f: any) => f.cause?.type !== 'version_conflict_engine_exception'),
        );
        throw new Error(`Update by query failed for some documents`);
      }
    }

    const updated = taskResult.updated ?? 0;
    const total = taskResult.total ?? 0;
    console.log(`  ✓ Updated ${updated} of ${total} documents`);
    return updated;
  }

  if ('took' in body) {
    if (body.failures && body.failures.length > 0) {
      const versionConflicts = body.failures.filter(
        (f: any) => f.cause?.type === 'version_conflict_engine_exception'
      ).length;
      const otherFailures = body.failures.length - versionConflicts;

      if (versionConflicts > 0) {
        console.log(
          `  ⚠️  ${versionConflicts} version conflicts (expected during active writes, will be caught on next run)`
        );
      }

      if (otherFailures > 0) {
        console.error(
          `  ⚠️  Encountered ${otherFailures} non-version-conflict failures:`,
          body.failures.filter((f: any) => f.cause?.type !== 'version_conflict_engine_exception'),
        );
        throw new Error(`Update by query failed for some documents`);
      }
    }

    const updated = body.updated ?? 0;
    const total = body.total ?? 0;
    console.log(`  ✓ Updated ${updated} of ${total} documents`);
    return updated;
  }

  console.log(`  ⚠️  Unexpected response format`);
  return 0;
}

async function verifyMigration(
  opensearchClient: Client,
  indexName: string,
  oldField: string,
  newField: string,
  dryRun: boolean
): Promise<void> {
  console.log(
    `  ${dryRun ? '[DRY-RUN] Would verify' : 'Verifying'} migration for "${oldField}" → "${newField}" in index "${indexName}"`
  );

  if (dryRun) {
    console.log(
      `  [DRY-RUN] Would fetch sample documents and compare date formats`
    );
    return;
  }

  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 3,
      query: {
        bool: {
          must: [
            { exists: { field: oldField } },
            { exists: { field: newField } }
          ]
        },
      },
      fields: [
        {
          field: oldField,
          format: 'strict_date_optional_time',
        },
        {
          field: newField,
          format: 'strict_date_optional_time',
        },
      ],
      _source: true,
    },
  });

  const hits = response.body.hits.hits;

  if (hits.length === 0) {
    console.log(`  ⚠️  No documents found with both "${oldField}" and "${newField}"`);
    return;
  }

  console.log(`  📊 Sample verification (showing ${hits.length} documents):`);

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const oldDateRaw = hit._source?.[oldField];
    const newDateRaw = hit._source?.[newField];
    const oldDateFormatted =
      hit.fields && hit.fields[oldField] ? hit.fields[oldField][0] : 'N/A';
    const newDateFormatted =
      hit.fields && hit.fields[newField] ? hit.fields[newField][0] : 'N/A';

    console.log(`\n    Document ${i + 1} (ID: ${hit._id}):`);
    console.log(`      ${oldField} (raw): ${oldDateRaw}`);
    console.log(`      ${oldField} (interpreted): ${oldDateFormatted}`);
    console.log(`      ${newField} (raw): ${newDateRaw}`);
    console.log(`      ${newField} (interpreted): ${newDateFormatted}`);

    if (oldDateRaw === newDateRaw) {
      console.log(`      ✓ Values match (${oldDateRaw})`);
    } else {
      console.log(
        `      ⚠️  Values don't match! ${oldDateRaw} vs ${newDateRaw}`
      );
    }
  }
}

async function checkIndexExists(
  opensearchClient: Client,
  indexName: string
): Promise<boolean> {
  const response = await opensearchClient.indices.exists({
    index: indexName,
  });
  return response.body;
}

async function migrateIndex(
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

  for (const dateField of migration.dateFields) {
    console.log(`\nProcessing field: ${dateField.oldField}`);

    await copyFieldData(
      opensearchClient,
      migration.indexName,
      dateField.oldField,
      dateField.newField,
      dryRun
    );

    await verifyMigration(
      opensearchClient,
      migration.indexName,
      dateField.oldField,
      dateField.newField,
      dryRun
    );
  }

  console.log(`\n✓ Completed migration for index: ${migration.indexName}`);
}

async function copyData(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Copy Timestamp Data ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script copies timestamp data from old fields to *_seconds fields.'
  );
  console.log('It only updates documents where the new field does not exist.');
  console.log('\n💡 Safe to run multiple times - it\'s idempotent!');

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Data will be copied');
  }

  try {
    for (const migration of MIGRATIONS) {
      await migrateIndex(opensearchClient, migration, dryRun);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Data copy completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run for real, set DRY_RUN=false environment variable\n'
      );
    } else {
      console.log('\n✓ All timestamp data has been copied to *_seconds fields.');
      console.log(
        '💡 Run this script again after deploying new code to catch any documents'
      );
      console.log('   added during the migration.\n');
    }
  } catch (error) {
    console.error('\n❌ Data copy failed:', error);
    throw error;
  }
}

const isDryRun = process.env.DRY_RUN !== 'false';

copyData(isDryRun);
