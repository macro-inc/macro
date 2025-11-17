// This script will update the entity_id field in all indices

require('dotenv').config();

import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  IS_DRY_RUN,
  PROJECT_INDEX,
} from '../constants';
import { checkIndexExists } from '../utils/check_index_exists';
import { copyFieldData, verifyFieldCopy } from '../utils/copy_field';

const ENTITY_ID_FIELD = 'entity_id';

type FieldToMigrate = {
  oldField: string;
  newField: string;
};

type IndexMigration = {
  indexName: string;
  fields: FieldToMigrate[];
};

const MIGRATIONS: IndexMigration[] = [
  {
    indexName: CHANNEL_INDEX,
    fields: [{ oldField: 'channel_id', newField: ENTITY_ID_FIELD }],
  },
  {
    indexName: CHAT_INDEX,
    fields: [{ oldField: 'chat_id', newField: ENTITY_ID_FIELD }],
  },
  {
    indexName: DOCUMENT_INDEX,
    fields: [{ oldField: 'document_id', newField: ENTITY_ID_FIELD }],
  },
  {
    indexName: EMAIL_INDEX,
    fields: [{ oldField: 'thread_id', newField: ENTITY_ID_FIELD }],
  },
  {
    indexName: PROJECT_INDEX,
    fields: [{ oldField: 'project_id', newField: ENTITY_ID_FIELD }],
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

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Copy entity id data ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script copies entity id data from old id field to entity_id field.'
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
      console.log('\n✓ All data has been copied.');
      console.log(
        'Run this script again after deploying new code to catch any documents added during the migration.'
      );
      console.log('Now run remove_legacy_id.ts to remove the old id field.\n');
    }
  } catch (error) {
    console.error('\n❌ Data copy failed:', error);
    throw error;
  }
}

run(IS_DRY_RUN);
