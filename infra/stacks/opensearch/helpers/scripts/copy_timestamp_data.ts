require('dotenv').config();

import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECT_INDEX,
} from '../constants';
import { checkIndexExists } from '../utils/check_index_exists';
import { copyFieldData, verifyFieldCopy } from '../utils/copy_field';

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

    await verifyFieldCopy(
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
  console.log("\n💡 Safe to run multiple times - it's idempotent!");

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
      console.log(
        '\n✓ All timestamp data has been copied to *_seconds fields.'
      );
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
