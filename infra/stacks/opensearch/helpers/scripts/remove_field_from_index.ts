/**
 * This script removes a field from the provided comma-separated list of indices.
 * Usage: bun scripts/remove_field_from_index.ts <indices> <field_name>
 */
require('dotenv').config();

import { client } from '../client';
import { IS_DRY_RUN } from '../constants';
import { removeField } from '../utils/remove_field';

// Get indices and user_id from command line arguments
const indicesArg = process.argv[2];
const fieldName = process.argv[3];

if (!indicesArg || !fieldName) {
  console.error('Missing required command line arguments:');
  console.error(
    'Usage: bun scripts/remove_field_from_index.ts <indices> <field_name>'
  );
  console.error(
    '  indices: Comma-separated list of index names (e.g., "documents,chats,emails")'
  );
  console.error('  field_name: The field name to remove');
  console.error('\nExample:');
  console.error('node script.js "documents,emails,chats" "random_field_name"');
  process.exit(1);
}

const INDICES_TO_PROCESS = indicesArg
  .split(',')
  .map((index: string) => index.trim());

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `OpenSearch Field Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(`\nThis script will remove ${fieldName} field`);
  console.log(
    '\n⚠️  WARNING: This will permanently delete data from documents!'
  );

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be permanently removed!');
  }

  for (const index of INDICES_TO_PROCESS) {
    console.log(`Processing index: ${index}`);
    try {
      removeField(opensearchClient, dryRun, {
        indexName: index,
        fieldNameToRemove: fieldName,
      });
      console.log('\n' + '='.repeat(60));
      console.log(`Cleanup completed successfully for ${index}!`);
      console.log('='.repeat(60));
    } catch (error) {
      console.error(
        `Error removing field ${fieldName} from index ${index}:`,
        error
      );
      process.exit(1);
    }
  }
}

run(IS_DRY_RUN);
