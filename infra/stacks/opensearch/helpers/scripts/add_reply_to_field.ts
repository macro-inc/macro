require('dotenv').config();

import { client } from '../client';
import { EMAIL_INDEX, IS_DRY_RUN } from '../constants';

async function addReplyToField(dryRun: boolean) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Add reply_to field to emails index ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
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

  console.log('\nAdding reply_to field mapping...');
  const mappingUpdate = {
    properties: {
      reply_to: {
        type: 'keyword' as const,
        index: true,
        doc_values: true,
      },
    },
  };

  if (dryRun) {
    console.log('[DRY-RUN] Would add reply_to field mapping');
  } else {
    const putMappingResponse = await opensearchClient.indices.putMapping({
      index: EMAIL_INDEX,
      body: mappingUpdate,
    });

    if (!putMappingResponse.body.acknowledged) {
      throw new Error('Failed to add reply_to field mapping');
    }
    console.log('✓ reply_to field mapping added');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\nTo run for real, set DRY_RUN=false environment variable\n');
  } else {
    console.log(
      '\n✓ reply_to field has been added to the emails index mapping.'
    );
    console.log(
      '✓ To backfill reply_to values, run: cargo run --bin backfill_email_search\n'
    );
  }
}

addReplyToField(IS_DRY_RUN);
