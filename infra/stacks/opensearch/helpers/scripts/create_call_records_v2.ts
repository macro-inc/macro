/**
 * Creates `call_records_v2` with the parent/child join mapping used for
 * the multi-term AND search migration. Does NOT touch the `call_records`
 * alias — `call_records_v2` is created idle so the
 * search_processing_service backfill can populate it (with
 * `index_override: "call_records_v2"`) while production reads/writes
 * continue to flow through `call_records` -> `call_records_v1`.
 *
 * Swap the alias separately, once backfill is caught up and the new
 * search query path is deployed.
 *
 * Usage:
 *   bun scripts/create_call_records_v2.ts
 *
 * Idempotent — safe to re-run; if `call_records_v2` already exists
 * nothing happens.
 */
require('dotenv').config();

import { client } from '../client';
import { SHARD_SETTINGS, SLOWLOG_SETTINGS } from '../constants';

const INDEX = 'call_records_v2';
const RELATION_PARENT = 'call';
const RELATION_CHILD = 'segment';

const BODY = {
  settings: {
    ...SHARD_SETTINGS,
    ...SLOWLOG_SETTINGS,
    refresh_interval: '2s',
  },
  mappings: {
    dynamic: 'false',
    properties: {
      entity_id: { type: 'keyword' },
      // Parent-only metadata
      channel_id: { type: 'keyword', index: true, doc_values: true },
      channel_name: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 128 } },
      },
      participant_ids: { type: 'keyword', index: true, doc_values: true },
      started_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      ended_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      // Child-only fields
      transcript_id: { type: 'keyword', index: false, doc_values: true },
      speaker_id: { type: 'keyword', index: true, doc_values: true },
      sequence_num: { type: 'integer', index: false, doc_values: true },
      content: { type: 'text', analyzer: 'standard' },
      // Aliases preserved for any reader that still expects them; both map
      // to the parent's call-start timestamp.
      created_at_seconds: { type: 'alias', path: 'started_at_seconds' },
      updated_at_seconds: { type: 'alias', path: 'started_at_seconds' },
      // Join relationship
      call_relation: {
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
