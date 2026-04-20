require('dotenv').config();

import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  IS_DRY_RUN,
} from '../constants';

const INDICES = [
  CHAT_INDEX,
  DOCUMENT_INDEX,
  CHANNEL_INDEX,
  'emails_alias',
];

async function setDynamicFalse(dryRun: boolean) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Set dynamic=false on indices ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));

  for (const index of INDICES) {
    const exists = (await opensearchClient.indices.exists({ index })).body;

    if (!exists) {
      console.log(`\nSkipping "${index}" (does not exist)`);
      continue;
    }

    console.log(`\nUpdating "${index}" dynamic=false...`);

    if (dryRun) {
      console.log(`[DRY-RUN] Would set dynamic=false on "${index}"`);
      continue;
    }

    const response = await opensearchClient.indices.putMapping({
      index,
      body: { dynamic: 'false' },
    });

    if (!response.body.acknowledged) {
      throw new Error(`Failed to update mapping for "${index}"`);
    }
    console.log(`Set dynamic=false on "${index}"`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\nTo run for real, set DRY_RUN=false environment variable\n');
  }
}

setDynamicFalse(IS_DRY_RUN);
