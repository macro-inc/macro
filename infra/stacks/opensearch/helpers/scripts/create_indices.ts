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
  SHARD_SETTINGS,
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
      console.log(`Adding alias ${aliasName} -> ${indexName}`);
      await opensearchClient.indices.putAlias({
        index: indexName,
        name: aliasName,
      });
      return;
    case 'create_with_alias':
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
        analyzer: 'standard',
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

const CHAT_BODY = {
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
      chat_message_id: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      user_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      role: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      title: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 50,
          },
        },
      },
      content: {
        type: 'text',
        analyzer: 'standard',
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
      content: {
        type: 'text',
        analyzer: 'standard',
      },
    },
  },
};

const CALL_RECORDS_BODY = {
  settings: {
    ...SHARD_SETTINGS,
    refresh_interval: '2s',
  },
  // One doc per transcript segment; `_id` is the `transcript_id`.
  mappings: {
    dynamic: 'false',
    properties: {
      entity_id: {
        type: 'keyword',
      },
      transcript_id: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      channel_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      participant_ids: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      channel_name: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 128,
          },
        },
      },
      speaker_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      sequence_num: {
        type: 'integer',
        index: false,
        doc_values: true,
      },
      content: {
        type: 'text',
        analyzer: 'standard',
      },
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
      created_at_seconds: {
        type: 'alias',
        path: 'started_at_seconds',
      },
      updated_at_seconds: {
        type: 'alias',
        path: 'started_at_seconds',
      },
    },
  },
};

async function createIndices() {
  const opensearchClient = client();
  console.log('Creating indices...');

  try {
    await createIndexWithAlias(opensearchClient, {
      indexName: DOCUMENTS_INDEX,
      aliasName: DOCUMENTS_ALIAS,
      body: DOCUMENT_BODY,
    });
    await createIndexWithAlias(opensearchClient, {
      indexName: CHATS_INDEX,
      aliasName: CHATS_ALIAS,
      body: CHAT_BODY,
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
    await createIndexWithAlias(opensearchClient, {
      indexName: CALL_RECORDS_INDEX,
      aliasName: CALL_RECORDS_ALIAS,
      body: CALL_RECORDS_BODY,
    });
    console.log('done');
  } catch (error) {
    console.error('Error', error);
  }
}

if (import.meta.main) {
  createIndices();
}
