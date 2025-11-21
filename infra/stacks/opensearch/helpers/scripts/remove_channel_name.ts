require('dotenv').config();

import { client } from '../client';
import { CHANNEL_INDEX, IS_DRY_RUN } from '../constants';
import { removeField } from '../utils/remove_field';

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `OpenSearch Field Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log('\nThis script will remove channel_name field');
  console.log(
    '\n⚠️  WARNING: This will permanently delete data from documents!'
  );

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be permanently removed!');
  }

  try {
    removeField(opensearchClient, dryRun, {
      indexName: CHANNEL_INDEX,
      fieldNameToRemove: 'channel_name',
    });

    console.log('\n' + '='.repeat(60));
    console.log('Cleanup completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run the cleanup for real, set DRY_RUN=false environment variable'
      );
    } else {
      console.log('\n✓ channel_name has been removed.');
    }
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    throw error;
  }
}

run(IS_DRY_RUN);
