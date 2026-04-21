require('dotenv').config();

import { client } from '../client';
import { IS_DRY_RUN, SHARD_SETTINGS } from '../constants';

const EMAIL_INDEX_V2 = 'emails_v2';

const EMAIL_MAPPINGS = {
  dynamic: 'false' as const,
  properties: {
    entity_id: { type: 'keyword' as const },
    message_id: { type: 'keyword' as const },
    thread_id: { type: 'keyword' as const },
    user_id: { type: 'keyword' as const },
    link_id: { type: 'keyword' as const },
    sender: { type: 'keyword' as const },
    recipients: { type: 'keyword' as const },
    cc: { type: 'keyword' as const },
    bcc: { type: 'keyword' as const },
    reply_to: {
      type: 'keyword' as const,
      index: true,
      doc_values: true,
    },
    labels: { type: 'keyword' as const, index: false },
    subject: {
      type: 'text' as const,
      fields: { keyword: { type: 'keyword' as const, ignore_above: 50 } },
    },
    content: { type: 'text' as const, analyzer: 'standard' },
    sender_name: { type: 'text' as const, analyzer: 'standard' },
    recipient_names: { type: 'text' as const, analyzer: 'standard' },
    cc_names: { type: 'text' as const, analyzer: 'standard' },
    bcc_names: { type: 'text' as const, analyzer: 'standard' },
    sent_at: { type: 'date' as const, index: false },
    sent_at_seconds: {
      type: 'date' as const,
      index: false,
      format: 'epoch_second',
    },
    updated_at: { type: 'date' as const, index: false },
    updated_at_seconds: {
      type: 'date' as const,
      index: false,
      format: 'epoch_second',
    },
  },
};

async function createEmailsV2(dryRun: boolean) {
  const opensearchClient = client();

  console.log('\n' + '='.repeat(60));
  console.log(
    `Create ${EMAIL_INDEX_V2} index ${dryRun ? '(DRY-RUN MODE)' : '(LIVE MODE)'}`
  );
  console.log('='.repeat(60));

  const exists = (
    await opensearchClient.indices.exists({ index: EMAIL_INDEX_V2 })
  ).body;

  if (exists) {
    console.log(`Index "${EMAIL_INDEX_V2}" already exists. Aborting.`);
    return;
  }

  if (dryRun) {
    console.log('\n[DRY-RUN] Would create index with settings:');
    console.log(JSON.stringify(SHARD_SETTINGS, null, 2));
    console.log('\n[DRY-RUN] Would create index with mappings:');
    console.log(JSON.stringify(EMAIL_MAPPINGS, null, 2));
    console.log('\nTo run for real, set DRY_RUN=false');
    return;
  }

  await opensearchClient.indices.create({
    index: EMAIL_INDEX_V2,
    body: {
      settings: SHARD_SETTINGS,
      mappings: EMAIL_MAPPINGS,
    },
  });

  console.log(`\nCreated ${EMAIL_INDEX_V2}`);

  console.log('\n' + '='.repeat(60));
  console.log('Done! Next steps:');
  console.log('  1. Deploy code that uses emails_alias');
  console.log(
    '  2. Swap alias: POST /_aliases { "actions": [{ "remove": { "index": "emails", "alias": "emails_alias" }}, { "add": { "index": "emails_v2", "alias": "emails_alias" }}] }'
  );
  console.log('  3. Backfill emails_v2');
  console.log('  4. Delete old emails index');
  console.log('='.repeat(60));
}

createEmailsV2(IS_DRY_RUN);
