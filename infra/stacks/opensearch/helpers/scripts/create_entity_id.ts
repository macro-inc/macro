// This script will add entity_id field to all indices
require('dotenv').config();

import type { Indices_PutMapping_RequestBody } from '@opensearch-project/opensearch/api/index.js';
import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  IS_DRY_RUN,
  PROJECT_INDEX,
} from '../constants';
import { addFieldToIndex } from '../utils/add_field';
import { checkIndexExists } from '../utils/check_index_exists';

const ENTITY_ID_FIELD = 'entity_id';

// List of all indices to be migrated
const MIGRATIONS: string[] = [
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECT_INDEX,
];

async function run(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Create entity_id field ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log('\nThis script will add entity_id field to indices.');

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be added to indices');
  }

  const mappingUpdate: Indices_PutMapping_RequestBody = {
    properties: {
      [ENTITY_ID_FIELD]: {
        type: 'keyword',
      },
    },
  };

  try {
    for (const index of MIGRATIONS) {
      const indexExists = await checkIndexExists(opensearchClient, index);
      if (indexExists) {
        console.log(`Index ${index} exists, skipping...`);
      }

      await addFieldToIndex(opensearchClient, index, mappingUpdate, dryRun);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Field creation completed successfully!');
    console.log('='.repeat(60));
    if (dryRun) {
      console.log(
        '\nTo run for real, set DRY_RUN=false environment variable\n'
      );
    } else {
      console.log('\n✓ All *_seconds fields have been added to indices.');
      console.log(
        '✓ Next step: Run copy_entity_id.ts to copy data from old fields.\n'
      );
    }
  } catch (error) {
    console.error('\n❌ Field creation failed:', error);
    throw error;
  }
}

run(IS_DRY_RUN);
