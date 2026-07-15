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
import { copyFieldData } from '../utils/copy_field';

// `<base>_seconds` → `<base>_millis` pairs to backfill. call_records only
// backfills the real started_at/ended_at fields; its created_at/updated_at
// are aliases onto started_at and need no separate data.
type FieldPair = { base: string };

interface IndexMigration {
  indexName: string;
  fields: FieldPair[];
}

const MIGRATIONS: IndexMigration[] = [
  {
    indexName: CHANNEL_INDEX,
    fields: [{ base: 'created_at' }, { base: 'updated_at' }],
  },
  {
    indexName: CHAT_INDEX,
    fields: [{ base: 'created_at' }, { base: 'updated_at' }],
  },
  {
    indexName: DOCUMENT_INDEX,
    fields: [{ base: 'updated_at' }],
  },
  {
    indexName: EMAIL_INDEX,
    fields: [{ base: 'updated_at' }, { base: 'sent_at' }],
  },
  {
    indexName: PROJECTS_ALIAS,
    fields: [{ base: 'created_at' }, { base: 'updated_at' }],
  },
  {
    indexName: CALL_RECORDS_ALIAS,
    fields: [{ base: 'started_at' }, { base: 'ended_at' }],
  },
];

/**
 * Sample docs that have both fields and confirm `millis` falls within the same
 * second as `seconds` (i.e. `floor(millis / 1000) === seconds`). This holds for
 * both backfilled docs (millis === seconds * 1000) and dual-written docs that
 * carry genuine sub-second precision (millis === seconds * 1000 + remainder).
 */
async function verifyMillis(
  opensearchClient: Client,
  indexName: string,
  secondsField: string,
  millisField: string
): Promise<void> {
  const response = await opensearchClient.search({
    index: indexName,
    body: {
      size: 50,
      query: {
        bool: {
          must: [
            { exists: { field: secondsField } },
            { exists: { field: millisField } },
          ],
        },
      },
      _source: [secondsField, millisField],
    },
  });

  const hits = response.body.hits.hits;
  if (hits.length === 0) {
    console.log(
      `  ⚠️  No documents with both "${secondsField}" and "${millisField}" to verify`
    );
    return;
  }

  let mismatches = 0;
  for (const hit of hits) {
    const seconds = hit._source?.[secondsField];
    const millis = hit._source?.[millisField];
    if (
      typeof seconds !== 'number' ||
      typeof millis !== 'number' ||
      Math.floor(millis / 1000) !== seconds
    ) {
      mismatches += 1;
      console.log(
        `  ⚠️  Mismatch (ID ${hit._id}): ${secondsField}=${seconds} ${millisField}=${millis}`
      );
    }
  }
  if (mismatches === 0) {
    console.log(
      `  ✓ Verified ${hits.length} sample docs: floor(${millisField} / 1000) === ${secondsField}`
    );
  } else {
    throw new Error(
      `${mismatches}/${hits.length} sample docs failed ${millisField} verification`
    );
  }
}

async function backfillIndex(
  opensearchClient: Client,
  migration: IndexMigration,
  dryRun: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `Backfilling millis for index: ${migration.indexName} ${dryRun ? '(DRY-RUN)' : ''}`
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

  for (const { base } of migration.fields) {
    const secondsField = `${base}_seconds`;
    const millisField = `${base}_millis`;
    console.log(`\nProcessing ${secondsField} → ${millisField}`);

    await copyFieldData(
      opensearchClient,
      migration.indexName,
      secondsField,
      millisField,
      dryRun,
      false, // only where millis is missing — idempotent, safe to re-run
      `ctx._source.${secondsField} * 1000L`
    );

    if (!dryRun) {
      await verifyMillis(
        opensearchClient,
        migration.indexName,
        secondsField,
        millisField
      );
    }
  }

  console.log(
    `\n✓ Completed millis backfill for index: ${migration.indexName}`
  );
}

async function backfill(dryRun: boolean = true) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Copy Timestamp Seconds → Millis ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));
  console.log(
    '\nThis script derives *_millis fields from *_seconds (× 1000) for existing docs.'
  );
  console.log('It only updates docs where the *_millis field is missing.');
  console.log("\n💡 Safe to run multiple times — it's idempotent.");
  console.log(
    '⚠️  Run create_timestamp_millis_fields.ts first so the mappings exist.'
  );

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made to the cluster');
  } else {
    console.log('\n🚨 LIVE MODE: Data will be backfilled');
  }

  try {
    for (const migration of MIGRATIONS) {
      await backfillIndex(opensearchClient, migration, dryRun);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Backfill completed successfully!');
    console.log('='.repeat(60));

    if (dryRun) {
      console.log(
        '\nTo run for real, set DRY_RUN=false environment variable\n'
      );
    } else {
      console.log('\n✓ All *_millis fields backfilled from *_seconds.');
      console.log(
        '💡 Re-run after deploying the dual-write code to catch docs written mid-migration.\n'
      );
    }
  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    throw error;
  }
}

const isDryRun = process.env.DRY_RUN !== 'false';

backfill(isDryRun);
