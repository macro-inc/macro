require('dotenv').config();

import { client } from '../client';
import { EMAIL_INDEX, IS_DRY_RUN } from '../constants';
import { checkIndexExists } from '../utils/check_index_exists';
import { copyFieldData } from '../utils/copy_field';

const MIGRATION = {
  indexName: EMAIL_INDEX,
  field: { valueField: 'sent_at_seconds', updateField: 'updated_at_seconds' },
};

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Update Updated At Seconds for Email ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script updates updated_at_seconds field to be the same as sent_at_seconds.'
  );
  console.log("\n💡 Safe to run multiple times - it's idempotent!");

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Data will be copied');
  }

  try {
    const indexExists = await checkIndexExists(
      opensearchClient,
      MIGRATION.indexName
    );

    if (!indexExists) {
      console.log(
        `⚠️  Index "${MIGRATION.indexName}" does not exist. Skipping...`
      );
      return;
    }

    await copyFieldData(
      opensearchClient,
      MIGRATION.indexName,
      MIGRATION.field.valueField,
      MIGRATION.field.updateField,
      dryRun,
      true // includeNonNull
    );

    console.log('\n' + '='.repeat(60));
    console.log('Data copy completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run for real, set DRY_RUN=false environment variable\n'
      );
    } else {
      console.log(
        '\n✓ All updated_at_seconds have been updated to match sent_at_seconds.'
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

run(IS_DRY_RUN);
