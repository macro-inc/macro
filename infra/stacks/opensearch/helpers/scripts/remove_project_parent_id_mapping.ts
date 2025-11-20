require('dotenv').config();

import { client } from '../client';
import { IS_DRY_RUN, PROJECT_INDEX } from '../constants';
import { removeField } from '../utils/remove_field';

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `OpenSearch Field Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log('\nThis script will remove old parent_project_id fields');
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
      indexName: PROJECT_INDEX,
      fieldNameToRemove: 'parent_project_id',
    });

    console.log('\n' + '='.repeat(60));
    console.log('Cleanup completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run the cleanup for real, set DRY_RUN=false environment variable'
      );
    } else {
      console.log('\n✓ parent_project_id has been removed.');
      console.log('✓ Only entity_id fields remain.\n');
    }
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    throw error;
  }
}

run(IS_DRY_RUN);
