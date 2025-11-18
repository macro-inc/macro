// This script will update the entity_id field in all indices

require('dotenv').config();

import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  IS_DRY_RUN,
  PROJECT_INDEX,
} from '../constants';
import type { IndexMigration } from '../utils/migrate_field';
import { migrateIndex } from '../utils/migrate_field';

const ENTITY_ID_FIELD = 'entity_id';

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
