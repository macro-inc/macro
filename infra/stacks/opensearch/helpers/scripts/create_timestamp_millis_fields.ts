require('dotenv').config();

import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CALL_RECORDS_ALIAS,
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECTS_ALIAS,
} from '../constants';
import { checkIndexExists } from '../utils/check_index_exists';

// A real `epoch_millis` date field to add.
type MillisField = { fieldName: string };
// An `alias` field pointing at an already-present real field. Used only by
// call_records, mirroring its existing created_at_seconds/updated_at_seconds
// aliases onto started_at_seconds.
type AliasField = { fieldName: string; aliasFor: string };

interface IndexMigration {
  indexName: string;
  fields: MillisField[];
  aliases?: AliasField[];
}

// Millisecond counterparts of every `*_seconds` field, matching the mappings
// in create_indices.ts. call_records keeps only started_at/ended_at as real
// fields; created_at/updated_at are aliases onto started_at.
const MIGRATIONS: IndexMigration[] = [
  {
    indexName: CHANNEL_INDEX,
    fields: [
      { fieldName: 'created_at_millis' },
      { fieldName: 'updated_at_millis' },
    ],
  },
  {
    indexName: CHAT_INDEX,
    fields: [
      { fieldName: 'created_at_millis' },
      { fieldName: 'updated_at_millis' },
    ],
  },
  {
    indexName: DOCUMENT_INDEX,
    fields: [{ fieldName: 'updated_at_millis' }],
  },
  {
    indexName: EMAIL_INDEX,
    fields: [
      { fieldName: 'updated_at_millis' },
      { fieldName: 'sent_at_millis' },
    ],
  },
  {
    indexName: PROJECTS_ALIAS,
    fields: [
      { fieldName: 'created_at_millis' },
      { fieldName: 'updated_at_millis' },
    ],
  },
  {
    indexName: CALL_RECORDS_ALIAS,
    fields: [
      { fieldName: 'started_at_millis' },
      { fieldName: 'ended_at_millis' },
    ],
    aliases: [
      { fieldName: 'created_at_millis', aliasFor: 'started_at_millis' },
      { fieldName: 'updated_at_millis', aliasFor: 'started_at_millis' },
    ],
  },
];

async function putMapping(
  opensearchClient: Client,
  indexName: string,
  properties: Record<string, unknown>,
  label: string,
  dryRun: boolean
): Promise<void> {
  console.log(
    `  ${dryRun ? '[DRY-RUN] Would add' : 'Adding'} ${label} to index "${indexName}"`
  );
  if (dryRun) {
    return;
  }
  const response = await opensearchClient.indices.putMapping({
    index: indexName,
    body: { properties },
  });
  if (!response.body.acknowledged) {
    throw new Error(`Failed to add ${label} in index "${indexName}"`);
  }
  console.log(`  ✓ Successfully added ${label}`);
}

async function addFieldsToIndex(
  opensearchClient: Client,
  migration: IndexMigration,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `Adding millis fields to index: ${migration.indexName} ${dryRun ? '(DRY-RUN)' : ''}`
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

  // Real date fields first, so any aliases can reference them.
  for (const field of migration.fields) {
    await putMapping(
      opensearchClient,
      migration.indexName,
      {
        [field.fieldName]: {
          type: 'date',
          format: 'epoch_millis',
          index: false,
          doc_values: true,
        },
      },
      `field "${field.fieldName}" (epoch_millis)`,
      dryRun
    );
  }

  for (const alias of migration.aliases ?? []) {
    await putMapping(
      opensearchClient,
      migration.indexName,
      { [alias.fieldName]: { type: 'alias', path: alias.aliasFor } },
      `alias "${alias.fieldName}" → "${alias.aliasFor}"`,
      dryRun
    );
  }

  console.log(`\n✓ Completed millis fields for index: ${migration.indexName}`);
}

async function createFields(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Create Timestamp Millis Fields ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script adds *_millis (epoch_millis) timestamp fields to indices.'
  );
  console.log(
    'Additive and idempotent; safe to run before or after the millis backfill.'
  );

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the cluster');
  } else {
    console.log('\n🚨 LIVE MODE: Fields will be added to indices');
  }

  try {
    for (const migration of MIGRATIONS) {
      await addFieldsToIndex(opensearchClient, migration, dryRun);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Field creation completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run for real, set DRY_RUN=false environment variable\n'
      );
    } else {
      console.log('\n✓ All *_millis fields have been added to indices.');
      console.log(
        '✓ Next step: run copy_timestamp_seconds_to_millis.ts to backfill existing docs.\n'
      );
    }
  } catch (error) {
    console.error('\n❌ Field creation failed:', error);
    throw error;
  }
}

const isDryRun = process.env.DRY_RUN !== 'false';

createFields(isDryRun);
