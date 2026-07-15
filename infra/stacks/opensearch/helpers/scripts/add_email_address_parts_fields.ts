require('dotenv').config();

import { client } from '../client';
import { EMAIL_INDEX, IS_DRY_RUN } from '../constants';

async function addEmailAddressPartsFields(dryRun: boolean) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Add domains and local_parts fields to emails index ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
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

  console.log('\nAdding domains and local_parts field mappings...');
  const mappingUpdate = {
    properties: {
      domains: {
        type: 'text' as const,
        analyzer: 'standard',
      },
      local_parts: {
        type: 'text' as const,
        analyzer: 'standard',
      },
    },
  };

  if (dryRun) {
    console.log('[DRY-RUN] Would add domains and local_parts field mappings');
  } else {
    const putMappingResponse = await opensearchClient.indices.putMapping({
      index: EMAIL_INDEX,
      body: mappingUpdate,
    });

    if (!putMappingResponse.body.acknowledged) {
      throw new Error('Failed to add field mappings');
    }
    console.log('✓ domains and local_parts field mappings added');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\nTo run for real, set DRY_RUN=false environment variable\n');
  } else {
    console.log(
      '\n✓ domains and local_parts have been added to the emails index mapping.'
    );
    console.log(
      '✓ After the new indexing code is deployed, backfill existing docs with: bun run scripts/backfill_email_address_parts.ts\n'
    );
  }
}

addEmailAddressPartsFields(IS_DRY_RUN);
