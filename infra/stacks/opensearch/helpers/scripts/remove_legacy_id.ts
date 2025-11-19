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
import { removeField } from '../utils/remove_field';

interface IndexCleanup {
  indexName: string;
  legacyIdField: string;
}

const CLEANUPS: IndexCleanup[] = [
  {
    indexName: CHANNEL_INDEX,
    legacyIdField: 'channel_id',
  },
  {
    indexName: CHAT_INDEX,
    legacyIdField: 'chat_id',
  },
  {
    indexName: DOCUMENT_INDEX,
    legacyIdField: 'document_id',
  },
  {
    indexName: EMAIL_INDEX,
    legacyIdField: 'thread_id',
  },
  {
    indexName: PROJECT_INDEX,
    legacyIdField: 'project_id',
  },
];

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `OpenSearch Field Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log('\nThis script will remove old id fields');
  console.log(
    '\n⚠️  WARNING: This will permanently delete data from documents!'
  );
  console.log('Make sure you have run copy_entity_id.ts first.');

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be permanently removed!');
  }

  try {
    for (const cleanup of CLEANUPS) {
      await removeField(opensearchClient, dryRun, {
        indexName: cleanup.indexName,
        fieldNameToRemove: cleanup.legacyIdField,
        replacementFieldName: 'entity_id',
      });
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
      console.log('\n✓ All old id fields have been removed.');
      console.log('✓ Only entity_id fields remain.\n');
    }
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    throw error;
  }
}

run(IS_DRY_RUN);
