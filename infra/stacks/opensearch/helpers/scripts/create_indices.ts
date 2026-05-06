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

async function createIndexWithAlias(
  opensearchClient: Client,
  { indexName, aliasName, body }: CreateIndexArgs
) {
  const indexExists = (
    await opensearchClient.indices.exists({ index: indexName })
  ).body;

  if (indexExists) {
    console.log(`${indexName} index already exists, ensuring alias...`);
    const aliasExists = (
      await opensearchClient.indices.existsAlias({
        name: aliasName,
        index: indexName,
      })
    ).body;
    if (!aliasExists) {
      console.log(`Adding alias ${aliasName} -> ${indexName}`);
      await opensearchClient.indices.putAlias({
        index: indexName,
        name: aliasName,
      });
    }
    return;
  }

  console.log(`${indexName} does not exist, creating with alias ${aliasName}`);
  await opensearchClient.indices.create({
    index: indexName,
    body: {
      ...body,
      aliases: {
        [aliasName]: {},
      },
    },
  });
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
      node_id: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      file_type: {
        type: 'keyword',
        index: false,
        doc_values: true,
      },
      owner_id: {
        type: 'keyword',
        index: true,
        doc_values: true,
      },
      document_name: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 128,
          },
        },
      },
      raw_content: {
        type: 'text',
      },
      content: {
        type: 'text',
        analyzer: 'standard',
      },
      updated_at_seconds: {
        type: 'date',
        format: 'epoch_second',
        index: false,
        doc_values: true,
      },
      sub_type: {
        type: 'keyword',
        index: true,
        doc_values: true,
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

createIndices();
