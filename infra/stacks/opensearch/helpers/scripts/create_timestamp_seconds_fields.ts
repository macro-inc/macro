require('dotenv').config();

import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECT_INDEX,
} from '../constants';

interface DateField {
  fieldName: string;
}

interface IndexMigration {
  indexName: string;
  dateFields: DateField[];
}

const MIGRATIONS: IndexMigration[] = [
  {
    indexName: CHANNEL_INDEX,
    dateFields: [
      { fieldName: 'created_at_seconds' },
      { fieldName: 'updated_at_seconds' },
    ],
  },
  {
    indexName: CHAT_INDEX,
    dateFields: [{ fieldName: 'updated_at_seconds' }],
  },
  {
    indexName: DOCUMENT_INDEX,
    dateFields: [{ fieldName: 'updated_at_seconds' }],
  },
  {
    indexName: EMAIL_INDEX,
    dateFields: [
      { fieldName: 'updated_at_seconds' },
      { fieldName: 'sent_at_seconds' },
    ],
  },
  {
    indexName: PROJECT_INDEX,
    dateFields: [
      { fieldName: 'created_at_seconds' },
      { fieldName: 'updated_at_seconds' },
    ],
  },
];

async function addDateFieldWithEpochSecondFormat(
  opensearchClient: Client,
  indexName: string,
  fieldName: string,
  dryRun: boolean
): Promise<void> {
  const mappingUpdate = {
    properties: {
      [fieldName]: {
        type: 'date' as const,
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
    },
  };

  console.log(
    `  ${dryRun ? '[DRY-RUN] Would add' : 'Adding'} field "${fieldName}" with epoch_second format to index "${indexName}"`
  );

  if (!dryRun) {
    const response = await opensearchClient.indices.putMapping({
      index: indexName,
      body: mappingUpdate,
    });

    if (!response.body.acknowledged) {
      throw new Error(
        `Failed to add mapping for field "${fieldName}" in index "${indexName}"`
      );
    }
    console.log(`  ✓ Successfully added field "${fieldName}"`);
  }
}

async function checkIndexExists(
  opensearchClient: Client,
  indexName: string
): Promise<boolean> {
  const response = await opensearchClient.indices.exists({
    index: indexName,
  });
  return response.body;
}

async function addFieldsToIndex(
  opensearchClient: Client,
  migration: IndexMigration,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `Adding fields to index: ${migration.indexName} ${dryRun ? '(DRY-RUN)' : ''}`
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

  for (const dateField of migration.dateFields) {
    console.log(`\nAdding field: ${dateField.fieldName}`);

    await addDateFieldWithEpochSecondFormat(
      opensearchClient,
      migration.indexName,
      dateField.fieldName,
      dryRun
    );
  }

  console.log(`\n✓ Completed adding fields for index: ${migration.indexName}`);
}

async function createFields(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Create Timestamp Seconds Fields ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log('\nThis script will add *_seconds timestamp fields to indices.');

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the database');
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
      console.log('\n✓ All *_seconds fields have been added to indices.');
      console.log(
        '✓ Next step: Run copy_timestamp_data.ts to copy data from old fields.\n'
      );
    }
  } catch (error) {
    console.error('\n❌ Field creation failed:', error);
    throw error;
  }
}

const isDryRun = process.env.DRY_RUN !== 'false';

createFields(isDryRun);
