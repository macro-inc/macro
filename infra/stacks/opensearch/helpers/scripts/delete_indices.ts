/**
 * This script deletes the provided comma-separated list of indices.
 * Usage: bun scripts/delete_indices.ts <indices>
 */
require('dotenv').config();

import { client } from '../client';
import { IS_DRY_RUN } from '../constants';
import { checkIndexExists } from '../utils/check_index_exists';

// Get indices and user_id from command line arguments
const indicesArg = process.argv[2];

if (!indicesArg) {
  console.error('Missing required command line arguments:');
  console.error('Usage: bun scripts/delete_indices.ts <indices>');
  console.error(
    '  indices: Comma-separated list of index names (e.g., "documents,chats,emails")'
  );
  console.error('\nExample:');
  console.error('bun scripts/delete_indices.ts "documents,emails,chats"');
  process.exit(1);
}

const INDICES_TO_PROCESS = indicesArg
  .split(',')
  .map((index: string) => index.trim());

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Opensearch Indices Cleanup Script ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(`\nThis script will delete ${INDICES_TO_PROCESS.join(', ')}`);
  console.log('\n⚠️  WARNING: This will permanently delete data!');

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be permanently removed!');
  }

  for (const index of INDICES_TO_PROCESS) {
    console.log(`Processing index: ${index}`);

    try {
      const indexExists = await checkIndexExists(opensearchClient, index);

      if (!indexExists) {
        console.log(`Index ${index} does not exist, skipping...`);
        continue;
      }

      console.log(`Index ${index} exists, deleting...`);

      if (dryRun) {
        console.log(`[DRY-RUN] Would delete index ${index}`);
        continue;
      }

      const result = await opensearchClient.indices.delete({
        index,
      });

      console.log(`${index} index deleted`, result.body);
    } catch (error) {
      console.error(`Error deleting index ${index}:`, error);
      process.exit(1);
    }
  }
}

run(IS_DRY_RUN);
