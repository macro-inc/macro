/**
 * Creates `chats_v2` with the parent/child join mapping used for the
 * multi-term AND search migration. Does NOT touch the `chats` alias —
 * `chats_v2` is created idle so the search_processing_service backfill
 * can populate it (with `index_override: "chats_v2"`) while production
 * reads/writes continue to flow through `chats` -> `chats_v1`.
 *
 * Swap the alias separately, once backfill is caught up and the new search
 * query path is deployed.
 *
 * Usage:
 *   bun scripts/create_chats_v2.ts
 *
 * Idempotent — safe to re-run; if `chats_v2` already exists nothing
 * happens.
 */
require('dotenv').config();

import { client } from '../client';
import { SHARD_SETTINGS, SLOWLOG_SETTINGS } from '../constants';

const INDEX = 'chats_v2';
const RELATION_PARENT = 'chat';
const RELATION_CHILD = 'message';

const BODY = {
  settings: {
    ...SHARD_SETTINGS,
    ...SLOWLOG_SETTINGS,
    refresh_interval: '1s',
  },
  mappings: {
    dynamic: 'false',
    properties: {
      entity_id: { type: 'keyword' },
      // Parent-only metadata
      title: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 50 } },
      },
      user_id: { type: 'keyword', index: true, doc_values: true },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      // Child-only fields
      chat_message_id: { type: 'keyword', index: false, doc_values: true },
      content: { type: 'text', analyzer: 'standard' },
      role: { type: 'keyword', index: false, doc_values: true },
      created_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      // Join relationship
      chat_relation: {
        type: 'join',
        relations: { [RELATION_PARENT]: RELATION_CHILD },
      },
    },
  },
};

async function run() {
  const c = client();
  const exists = (await c.indices.exists({ index: INDEX })).body;
  if (exists) {
    console.log(`${INDEX} already exists; nothing to do.`);
    return;
  }
  console.log(`Creating ${INDEX} (no alias)`);
  await c.indices.create({ index: INDEX, body: BODY });
  console.log(`${INDEX} created`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
