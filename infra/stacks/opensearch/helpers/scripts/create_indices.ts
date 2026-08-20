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

export type CreateIndexArgs = {
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

/**
 * Field-level drift between an index body in this file and the mapping that is
 * actually live on the cluster.
 *
 * `updates` is the `properties` payload of a `_mapping` PUT: the full desired
 * definition of every top-level field that is missing fields, which OpenSearch
 * merges additively. `missingPaths` and `conflictPaths` are dotted field paths
 * for the operator log.
 */
export type MappingConvergencePlan = {
  updates: Record<string, unknown>;
  missingPaths: string[];
  conflictPaths: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fieldType = (definition: unknown): string | undefined => {
  if (!isRecord(definition)) return undefined;
  return typeof definition.type === 'string' ? definition.type : undefined;
};

/**
 * Sub-fields of one field definition: object/nested members under
 * `properties`, plus multi-fields under `fields`. A field can never have both,
 * so flattening them into one namespace can't collide.
 */
const subFields = (definition: unknown): Record<string, unknown> => {
  if (!isRecord(definition)) return {};
  return {
    ...(isRecord(definition.properties) ? definition.properties : {}),
    ...(isRecord(definition.fields) ? definition.fields : {}),
  };
};

function collectFieldDrift(
  path: string,
  desired: unknown,
  live: unknown,
  missingPaths: string[],
  conflictPaths: string[]
) {
  const desiredType = fieldType(desired);
  const liveType = fieldType(live);
  // A type change can't be applied additively — it needs a reindex, so record
  // it and stop descending (children of a differently-typed field are moot).
  if (desiredType && liveType && desiredType !== liveType) {
    conflictPaths.push(path);
    return;
  }

  const desiredSubFields = subFields(desired);
  const liveSubFields = subFields(live);
  for (const [name, desiredSubField] of Object.entries(desiredSubFields)) {
    const subPath = `${path}.${name}`;
    if (!(name in liveSubFields)) {
      missingPaths.push(subPath);
      continue;
    }
    collectFieldDrift(
      subPath,
      desiredSubField,
      liveSubFields[name],
      missingPaths,
      conflictPaths
    );
  }
}

/**
 * Pure decision: which fields does the live mapping lack, and which of them
 * can be added without a reindex?
 *
 * Only field *presence* is compared, never per-field parameters: OpenSearch
 * echoes back a normalized mapping (defaults omitted, some values rewritten),
 * so diffing parameters would report drift on every index forever. A field
 * whose `type` disagrees lands in `conflictPaths` and is left alone — changing
 * a live field's type requires `reindex_with_alias_swap.ts`. Anything else
 * missing is additive, so the whole top-level definition goes into `updates`
 * for OpenSearch to merge.
 */
export function planMappingConvergence(args: {
  desired: Record<string, unknown> | undefined;
  live: Record<string, unknown> | undefined;
}): MappingConvergencePlan {
  const desired = args.desired ?? {};
  const live = args.live ?? {};

  const updates: Record<string, unknown> = {};
  const missingPaths: string[] = [];
  const conflictPaths: string[] = [];

  for (const [name, desiredDefinition] of Object.entries(desired)) {
    if (!(name in live)) {
      missingPaths.push(name);
      updates[name] = desiredDefinition;
      continue;
    }

    const fieldMissing: string[] = [];
    const fieldConflicts: string[] = [];
    collectFieldDrift(
      name,
      desiredDefinition,
      live[name],
      fieldMissing,
      fieldConflicts
    );
    missingPaths.push(...fieldMissing);
    conflictPaths.push(...fieldConflicts);
    // Sending a definition that carries a conflict would be rejected wholesale,
    // taking the additive sub-fields down with it.
    if (fieldMissing.length > 0 && fieldConflicts.length === 0) {
      updates[name] = desiredDefinition;
    }
  }

  return { updates, missingPaths, conflictPaths };
}

/**
 * Bring an existing index's mapping up to the body declared above by adding
 * whatever fields it is missing.
 *
 * Index creation is one-shot, so a field added to a body here never reaches an
 * index that already exists — and because every body is `dynamic: 'false'`,
 * writes of the new field are dropped silently and searches over it match
 * nothing (macro-2731: `call_records_v2` never got `properties`/`name`, so tag
 * filters and name matches on calls returned empty). Converging on every run
 * makes the body the single source of truth instead of a one-off script.
 */
async function convergeMapping(
  opensearchClient: Client,
  indexName: string,
  body: Record<string, unknown>
) {
  const desiredMappings = isRecord(body.mappings) ? body.mappings : undefined;
  const desired = isRecord(desiredMappings?.properties)
    ? (desiredMappings?.properties as Record<string, unknown>)
    : undefined;

  const response = await opensearchClient.indices.getMapping({
    index: indexName,
  });
  const liveMappings = (response.body ?? {})[indexName]?.mappings;
  const live = isRecord(liveMappings?.properties)
    ? (liveMappings?.properties as Record<string, unknown>)
    : undefined;

  const plan = planMappingConvergence({ desired, live });

  for (const path of plan.conflictPaths) {
    console.log(
      `${indexName}: ⚠️  "${path}" has a different type live than in this file. ` +
        `A type change needs a reindex — run reindex_with_alias_swap.ts.`
    );
  }

  if (Object.keys(plan.updates).length === 0) {
    if (plan.conflictPaths.length === 0) {
      console.log(`${indexName}: mapping matches this file`);
    }
    return;
  }

  console.log(
    `${indexName}: mapping is missing ${plan.missingPaths.length} field(s): ${plan.missingPaths.join(', ')}`
  );

  if (IS_DRY_RUN) {
    console.log(
      `[DRY-RUN] Would add ${Object.keys(plan.updates).join(', ')} to ${indexName}`
    );
    return;
  }

  const putMappingResponse = await opensearchClient.indices.putMapping({
    index: indexName,
    body: { properties: plan.updates },
  });
  if (!putMappingResponse.body.acknowledged) {
    throw new Error(`Failed to add mapping fields to ${indexName}`);
  }
  console.log(
    `✓ ${indexName}: added ${Object.keys(plan.updates).join(', ')}. ` +
      `Backfill the affected entity to populate existing docs.`
  );
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
      await convergeMapping(opensearchClient, indexName, body);
      return;
    case 'add_alias':
      if (IS_DRY_RUN) {
        console.log(`[DRY-RUN] Would add alias ${aliasName} -> ${indexName}`);
      } else {
        console.log(`Adding alias ${aliasName} -> ${indexName}`);
        await opensearchClient.indices.putAlias({
          index: indexName,
          name: aliasName,
        });
      }
      await convergeMapping(opensearchClient, indexName, body);
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
      await convergeMapping(opensearchClient, indexName, body);
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

// Splits addresses into positioned segment tokens for the `.parts`
// sub-fields: `Jane.Doe@Mail.Foo.com` -> [jane, doe, mail, foo, com].
// Same-width space replacements keep highlight offsets aligned, and the
// positions make dotted query phrases require in-order adjacent segments.
const EMAIL_PARTS_ANALYSIS = {
  char_filter: {
    email_separators: {
      type: 'mapping',
      mappings: ['@ => \\u0020', '. => \\u0020', '+ => \\u0020'],
    },
  },
  analyzer: {
    email_parts: {
      type: 'custom',
      char_filter: ['email_separators'],
      tokenizer: 'standard',
      filter: ['lowercase'],
    },
  },
};

const EMAIL_ADDRESS_FIELD = {
  type: 'keyword',
  index: true,
  doc_values: true,
  fields: {
    parts: {
      type: 'text',
      analyzer: 'email_parts',
    },
  },
};

const EMAIL_BODY = {
  settings: {
    ...SHARD_SETTINGS,
    refresh_interval: '2s',
    analysis: EMAIL_PARTS_ANALYSIS,
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
      sender: EMAIL_ADDRESS_FIELD,
      reply_to: EMAIL_ADDRESS_FIELD,
      recipients: EMAIL_ADDRESS_FIELD,
      cc: EMAIL_ADDRESS_FIELD,
      bcc: EMAIL_ADDRESS_FIELD,
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

/**
 * Every index this repo owns, with the mapping it is supposed to have.
 * `verify_mappings.ts` reads the same list so a drift check and a converging
 * run can never disagree about what the desired mapping is.
 *
 * chats and call_records use parent/child join mappings (bodies inlined above
 * as CHATS_V2_BODY / CALL_RECORDS_V2_BODY).
 */
export const INDEX_SPECS: CreateIndexArgs[] = [
  {
    indexName: DOCUMENTS_INDEX,
    aliasName: DOCUMENTS_ALIAS,
    body: DOCUMENT_BODY,
  },
  { indexName: EMAILS_INDEX, aliasName: EMAILS_ALIAS, body: EMAIL_BODY },
  { indexName: CHANNELS_INDEX, aliasName: CHANNELS_ALIAS, body: CHANNEL_BODY },
  { indexName: CHATS_INDEX, aliasName: CHATS_ALIAS, body: CHATS_V2_BODY },
  {
    indexName: CALL_RECORDS_INDEX,
    aliasName: CALL_RECORDS_ALIAS,
    body: CALL_RECORDS_V2_BODY,
  },
  { indexName: PROJECTS_INDEX, aliasName: PROJECTS_ALIAS, body: PROJECTS_BODY },
];

/**
 * Narrow a run to one index by alias or physical name (`INDEX=call_records`).
 *
 * An environment can sit mid-migration on one index while another needs a
 * field added — prod held `emails` on `emails_v1` while `call_records_v2` was
 * missing its `properties` mapping, and an unscoped run there would have
 * created an empty `emails_v2` as a side effect. Scoping keeps a mapping fix
 * from touching an unrelated migration.
 */
export function selectIndexSpecs(
  specs: CreateIndexArgs[],
  filter: string | undefined
): CreateIndexArgs[] {
  if (!filter) return specs;
  return specs.filter(
    (spec) => spec.indexName === filter || spec.aliasName === filter
  );
}

async function createIndices() {
  const opensearchClient = client();
  const filter = process.env.INDEX;
  const specs = selectIndexSpecs(INDEX_SPECS, filter);
  if (specs.length === 0) {
    console.log(
      `⚠️  INDEX="${filter}" matches no index. Known: ` +
        `${INDEX_SPECS.map((s) => s.aliasName).join(', ')}. Aborting.`
    );
    return;
  }

  console.log(
    `Creating indices and converging mappings${filter ? ` for "${filter}"` : ''}... ${IS_DRY_RUN ? '(DRY-RUN MODE — set DRY_RUN=false to apply)' : '(LIVE MODE)'}`
  );

  try {
    // Idempotent — indices that already exist keep their data and only gain
    // fields this file declares that they are missing.
    for (const spec of specs) {
      await createIndexWithAlias(opensearchClient, spec);
    }
    console.log('done');
  } catch (error) {
    console.error('Error', error);
  }
}

if (import.meta.main) {
  createIndices();
}
