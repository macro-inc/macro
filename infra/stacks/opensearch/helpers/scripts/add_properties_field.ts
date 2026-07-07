require('dotenv').config();

import { client } from '../client';
import { CHATS_ALIAS, EMAILS_ALIAS, IS_DRY_RUN } from '../constants';

// Indexes that receive the nested entity-properties field additively
// (documents shipped with it; projects_v1 was created with it).
const SUPPORTED_INDEXES = [EMAILS_ALIAS, CHATS_ALIAS];

async function addPropertiesField(dryRun: boolean) {
  const index = process.env.INDEX;
  if (!index || !SUPPORTED_INDEXES.includes(index)) {
    console.log(
      `⚠️  Set INDEX to one of: ${SUPPORTED_INDEXES.join(', ')}. Aborting.`
    );
    return;
  }

  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Add nested properties field to "${index}" index ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made');
  }

  const indexExists = (await opensearchClient.indices.exists({ index })).body;

  if (!indexExists) {
    console.log(`⚠️  Index "${index}" does not exist. Aborting.`);
    return;
  }

  console.log('\nAdding nested properties field mapping...');
  const mappingUpdate = {
    properties: {
      // Entity properties (e.g. tags), same nested shape as the documents
      // index so the shared property/tag filters apply unchanged. Emails:
      // thread-level values denormalized onto every message doc. Chats:
      // values live on the parent chat doc only.
      properties: {
        type: 'nested' as const,
        properties: {
          definition_id: { type: 'keyword' as const },
          values: { type: 'keyword' as const },
          number_value: { type: 'double' as const },
          date_value: { type: 'date' as const },
        },
      },
    },
  };

  if (dryRun) {
    console.log('[DRY-RUN] Would add nested properties field mapping');
  } else {
    const putMappingResponse = await opensearchClient.indices.putMapping({
      index,
      body: mappingUpdate,
    });

    if (!putMappingResponse.body.acknowledged) {
      throw new Error('Failed to add field mapping');
    }
    console.log('✓ nested properties field mapping added');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\nTo run for real, set DRY_RUN=false environment variable\n');
  } else {
    console.log(
      `\n✓ properties field has been added to the "${index}" index mapping.`
    );
    console.log(
      '✓ To backfill existing tags, POST /internal/backfill/properties with the matching entity_type.\n'
    );
  }
}

addPropertiesField(IS_DRY_RUN);
