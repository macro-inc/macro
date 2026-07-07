require('dotenv').config();

import { client } from '../client';
import { EMAIL_INDEX, IS_DRY_RUN } from '../constants';

async function addPropertiesField(dryRun: boolean) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Add nested properties field to emails index ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN MODE: No changes will be made');
  }

  const indexExists = (
    await opensearchClient.indices.exists({ index: EMAIL_INDEX })
  ).body;

  if (!indexExists) {
    console.log(`⚠️  Index "${EMAIL_INDEX}" does not exist. Aborting.`);
    return;
  }

  console.log('\nAdding nested properties field mapping...');
  const mappingUpdate = {
    properties: {
      // Thread-level entity properties (e.g. tags), denormalized onto every
      // message doc of the thread. Same nested shape as the documents index
      // so the shared property/tag filters apply unchanged.
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
      index: EMAIL_INDEX,
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
      '\n✓ properties field has been added to the emails index mapping.'
    );
    console.log(
      '✓ To backfill existing thread tags, enqueue an UpdateDocumentProperties search-queue message per tagged thread (entity_type "thread").\n'
    );
  }
}

addPropertiesField(IS_DRY_RUN);
