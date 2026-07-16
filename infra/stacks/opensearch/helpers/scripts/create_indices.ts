import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CALL_RECORDS_ALIAS,
  CALL_RECORDS_INDEX,
  CHANNELS_ALIAS,
  CHANNELS_INDEX,
  CHATS_ALIAS,
  CHATS_INDEX,
  DOCUMENTS_ALIAS,
  DOCUMENTS_INDEX,
  EMAILS_ALIAS,
  EMAILS_INDEX,
  IS_DRY_RUN,
  PROJECTS_ALIAS,
  PROJECTS_INDEX,
  SHARD_SETTINGS,
  SLOWLOG_SETTINGS,
} from '../constants';

type CreateIndexArgs = {
  indexName: string;
  aliasName: string;
  body: Record<string, unknown>;
};

export type CreateIndexState = {
  indexExists: boolean;
  aliasExistsOnIndex: boolean;
  aliasNameIsPhysicalIndex: boolean;
  aliasTargets: string[];
};

export type CreatePlan =
  | { kind: 'noop'; reason: string }
  | { kind: 'create_with_alias' }
  | { kind: 'create_without_alias'; nextStep: string }
  | { kind: 'add_alias' }
  | { kind: 'defer_alias'; nextStep: string };

/**
 * Pure decision: given the observed cluster state for one (indexName,
 * aliasName) pair, what should this script do?
 *
 * The interesting cases are mid-migration ones. If the alias name is
 * currently a bare physical index (e.g. `channels` is a physical index
 * and we want to create `channels_v1` aliased as `channels`), we can't
 * add the alias yet — that has to happen atomically alongside the
 * removal of the conflicting physical index, which is the swap script's
 * job. So we create the new versioned index without an alias and tell
 * the operator to run `reindex_with_alias_swap.ts` next. Same logic
 * when the alias already points at a different index.
 */
export function planCreateIndex(state: CreateIndexState): CreatePlan {
  const {
    indexExists,
    aliasExistsOnIndex,
    aliasNameIsPhysicalIndex,
    aliasTargets,
  } = state;
  const aliasOnDifferentIndex =
    aliasTargets.length > 0 && !aliasTargets.includes('__SELF__');
  // Caller passes '__SELF__' in aliasTargets when the alias already includes
  // indexName, so we can keep this function pure of indexName.

  const aliasIsBlocked = aliasNameIsPhysicalIndex || aliasOnDifferentIndex;
  const aliasBlockReason = aliasNameIsPhysicalIndex
    ? `alias name is currently a bare physical index`
    : `alias points at ${aliasTargets.join(', ')}`;

  if (indexExists) {
    if (aliasExistsOnIndex) {
      return { kind: 'noop', reason: 'index and alias already in place' };
    }
    if (aliasIsBlocked) {
      return {
        kind: 'defer_alias',
        nextStep:
          `index exists but alias "${aliasBlockReason}". Run ` +
          `reindex_with_alias_swap.ts to complete the migration.`,
      };
    }
    return { kind: 'add_alias' };
  }

  if (aliasIsBlocked) {
    return {
      kind: 'create_without_alias',
      nextStep:
        `creating index now; alias deferred (${aliasBlockReason}). ` +
        `Run reindex_with_alias_swap.ts next to swap the alias atomically.`,
    };
  }

  return { kind: 'create_with_alias' };
}

async function createIndexWithAlias(
  opensearchClient: Client,
  { indexName, aliasName, body }: CreateIndexArgs
) {
  const indexExists = (
    await opensearchClient.indices.exists({ index: indexName })
  ).body;

  const aliasExistsOnIndex = (
    await opensearchClient.indices.existsAlias({
      name: aliasName,
      index: indexName,
    })
  ).body;

  const aliasNameIsPhysicalIndex = await (async () => {
    const a = await opensearchClient.indices.existsAlias({ name: aliasName });
    if (a.body) return false;
    const i = await opensearchClient.indices.exists({ index: aliasName });
    return i.body;
  })();

  const rawAliasTargets = await (async () => {
    try {
      const r = await opensearchClient.indices.getAlias({ name: aliasName });
      return Object.keys(r.body ?? {});
    } catch {
      return [] as string[];
    }
  })();
  // Normalize: if the alias already includes our target index, we want
  // planCreateIndex to ignore those targets. We collapse "alias touches
  // indexName" to a sentinel so the pure function doesn't need indexName.
  const aliasTargets = rawAliasTargets.includes(indexName)
    ? ['__SELF__']
    : rawAliasTargets;

  const plan = planCreateIndex({
    indexExists,
    aliasExistsOnIndex,
    aliasNameIsPhysicalIndex,
    aliasTargets,
  });

  switch (plan.kind) {
    case 'noop':
      console.log(`${indexName}: ${plan.reason}`);
      return;
    case 'add_alias':
      if (IS_DRY_RUN) {
        console.log(`[DRY-RUN] Would add alias ${aliasName} -> ${indexName}`);
        return;
      }
      console.log(`Adding alias ${aliasName} -> ${indexName}`);
      await opensearchClient.indices.putAlias({
        index: indexName,
        name: aliasName,
      });
      return;
    case 'create_with_alias':
      if (IS_DRY_RUN) {
        console.log(
          `[DRY-RUN] Would create ${indexName} with alias ${aliasName}`
        );
        return;
      }
      console.log(
        `${indexName} does not exist, creating with alias ${aliasName}`
      );
      await opensearchClient.indices.create({
        index: indexName,
        body: { ...body, aliases: { [aliasName]: {} } },
      });
      return;
    case 'create_without_alias':
      console.log(`${indexName}: ${plan.nextStep}`);
      if (IS_DRY_RUN) {
        console.log(`[DRY-RUN] Would create ${indexName} without alias`);
        return;
      }
      await opensearchClient.indices.create({
        index: indexName,
        body,
      });
      return;
    case 'defer_alias':
      console.log(`${indexName}: ${plan.nextStep}`);
      return;
  }
}

const CHANNEL_BODY = {
  settings: {
    ...SHARD_SETTINGS,
    refresh_interval: '1s',
    analysis: {
      analyzer: {
        content_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['icu_folding'],
        },
      },
    },
  },
  mappings: {
    dynamic: 'false',
    properties: {
      // channel id
      entity_id: {
        type: 'keyword',
      },
      channel_type: {
        type: 'keyword',
        index: true,
      },
      org_id: {
        type: 'integer',
        index: true,
      },
      // channel message id
      message_id: {
        type: 'keyword',
      },
      thread_id: {
        type: 'keyword',
        index: true,
      },
      sender_id: {
        type: 'keyword',
        index: true,
      },
      mentions: {
        type: 'keyword',
        index: true,
      },
      content: {
        type: 'text',
        analyzer: 'content_text',
      },
      created_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      created_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      updated_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
    },
  },
};

// `documents_v2` uses an OpenSearch parent/child `join` field so we can
// AND multi-term searches across chunks of the same document via
// `has_child` queries. Parents carry the document's metadata; children
// carry per-chunk content. All children must be written with
// `routing = parent _id` so the pair lands on the same shard.
const DOCUMENT_BODY = {
  settings: {
    ...SHARD_SETTINGS,
    refresh_interval: '1s',
  },
  mappings: {
    dynamic: 'false',
    properties: {
      entity_id: {
        type: 'keyword',
      },
      // Parent-only metadata
      document_name: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 128,
          },
        },
      },
      owner_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      file_type: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      sub_type: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      updated_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      // Parent-only entity properties (status, priority, assignees, custom).
      // `nested` so a property filter matches definition_id + its value
      // within the same entry rather than cross-matching across properties.
      properties: {
        type: 'nested',
        properties: {
          definition_id: { type: 'keyword' },
          values: { type: 'keyword' },
          number_value: { type: 'double' },
          date_value: { type: 'date' },
        },
      },
      // Child-only fields
      node_id: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      content: {
        type: 'text',
        analyzer: 'standard',
      },
      raw_content: {
        type: 'text',
      },
      // Join relationship
      document_relation: {
        type: 'join',
        relations: { document: 'chunk' },
      },
    },
  },
};

// `projects_v1` is flat: one doc per project, `_id` = project id. Projects
// have no content to chunk, so no join field. Access control follows the
// documents pattern — only `owner_id` is indexed; the caller's accessible
// project ids are resolved from Postgres at query time.
const PROJECTS_BODY = {
  settings: {
    ...SHARD_SETTINGS,
    ...SLOWLOG_SETTINGS,
    refresh_interval: '1s',
  },
  mappings: {
    dynamic: 'false',
    properties: {
      entity_id: {
        type: 'keyword',
      },
      name: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 128,
          },
        },
      },
      owner_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      parent_project_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      created_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      created_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      updated_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      // Entity properties (tags, custom). Same nested shape as the documents
      // index so the shared property/tag query builders apply unchanged.
      properties: {
        type: 'nested',
        properties: {
          definition_id: { type: 'keyword' },
          values: { type: 'keyword' },
          number_value: { type: 'double' },
          date_value: { type: 'date' },
        },
      },
    },
  },
};

const EMAIL_BODY = {
  settings: {
    ...SHARD_SETTINGS,
    refresh_interval: '2s',
  },
  mappings: {
    dynamic: 'false',
    properties: {
      entity_id: {
        type: 'keyword',
      },
      message_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      sender: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      reply_to: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      recipients: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      cc: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      bcc: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      sender_name: {
        type: 'text',
        analyzer: 'standard',
      },
      recipient_names: {
        type: 'text',
        analyzer: 'standard',
      },
      cc_names: {
        type: 'text',
        analyzer: 'standard',
      },
      bcc_names: {
        type: 'text',
        analyzer: 'standard',
      },
      labels: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      link_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      user_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      updated_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      subject: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 50,
          },
        },
      },
      sent_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      sent_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      content: {
        type: 'text',
        analyzer: 'standard',
      },
      // Thread-level entity properties (e.g. tags), denormalized onto every
      // message doc of the thread. Same nested shape as the documents index
      // so the shared property/tag filters apply unchanged.
      properties: {
        type: 'nested',
        properties: {
          definition_id: { type: 'keyword' },
          values: { type: 'keyword' },
          number_value: { type: 'double' },
          date_value: { type: 'date' },
        },
      },
    },
  },
};

// chats and call_records use parent/child join mappings for multi-term AND
// search. Their bodies live here (single entrypoint); the join relation names
// are the only structural difference from the flat indices above.
const CHATS_RELATION_PARENT = 'chat';
const CHATS_RELATION_CHILD = 'message';

const CHATS_V2_BODY = {
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
      updated_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      // Parent-only entity properties (tags, custom). Same nested shape as
      // DOCUMENT_BODY so property filters match definition_id + value within
      // the same entry rather than cross-matching across properties.
      properties: {
        type: 'nested',
        properties: {
          definition_id: { type: 'keyword' },
          values: { type: 'keyword' },
          number_value: { type: 'double' },
          date_value: { type: 'date' },
        },
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
      created_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      // Join relationship
      chat_relation: {
        type: 'join',
        relations: { [CHATS_RELATION_PARENT]: CHATS_RELATION_CHILD },
      },
    },
  },
};

const CALL_RECORDS_RELATION_PARENT = 'call';
const CALL_RECORDS_RELATION_CHILD = 'segment';

const CALL_RECORDS_V2_BODY = {
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
      // Searchable display name of the call (custom name, falling back to the
      // channel name). Matched in Name/NameContent mode.
      name: {
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
      started_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      ended_at_millis: {
        type: 'date',
        format: 'epoch_millis',
        index: false,
        doc_values: true,
      },
      // Parent-only entity properties (tags, custom). Same nested shape as
      // DOCUMENT_BODY so property filters match definition_id + value within
      // the same entry rather than cross-matching across properties.
      properties: {
        type: 'nested',
        properties: {
          definition_id: { type: 'keyword' },
          values: { type: 'keyword' },
          number_value: { type: 'double' },
          date_value: { type: 'date' },
        },
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
      created_at_millis: { type: 'alias', path: 'started_at_millis' },
      updated_at_millis: { type: 'alias', path: 'started_at_millis' },
      // Join relationship
      call_relation: {
        type: 'join',
        relations: {
          [CALL_RECORDS_RELATION_PARENT]: CALL_RECORDS_RELATION_CHILD,
        },
      },
    },
  },
};

async function createIndices() {
  const opensearchClient = client();
  console.log(
    `Creating indices... ${IS_DRY_RUN ? '(DRY-RUN MODE — set DRY_RUN=false to apply)' : '(LIVE MODE)'}`
  );

  try {
    await createIndexWithAlias(opensearchClient, {
      indexName: DOCUMENTS_INDEX,
      aliasName: DOCUMENTS_ALIAS,
      body: DOCUMENT_BODY,
    });
    await createIndexWithAlias(opensearchClient, {
      indexName: EMAILS_INDEX,
      aliasName: EMAILS_ALIAS,
      body: EMAIL_BODY,
    });
    await createIndexWithAlias(opensearchClient, {
      indexName: CHANNELS_INDEX,
      aliasName: CHANNELS_ALIAS,
      body: CHANNEL_BODY,
    });
    // chats and call_records use parent/child join mappings (bodies inlined
    // above as CHATS_V2_BODY / CALL_RECORDS_V2_BODY). Idempotent — no-ops where
    // they already exist.
    await createIndexWithAlias(opensearchClient, {
      indexName: CHATS_INDEX,
      aliasName: CHATS_ALIAS,
      body: CHATS_V2_BODY,
    });
    await createIndexWithAlias(opensearchClient, {
      indexName: CALL_RECORDS_INDEX,
      aliasName: CALL_RECORDS_ALIAS,
      body: CALL_RECORDS_V2_BODY,
    });
    await createIndexWithAlias(opensearchClient, {
      indexName: PROJECTS_INDEX,
      aliasName: PROJECTS_ALIAS,
      body: PROJECTS_BODY,
    });
    console.log('done');
  } catch (error) {
    console.error('Error', error);
  }
}

if (import.meta.main) {
  createIndices();
}
