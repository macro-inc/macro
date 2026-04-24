import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CALL_RECORDS_ALIAS,
  CALL_RECORDS_INDEX,
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  SHARD_SETTINGS,
} from '../constants';

async function createChannelIndex(opensearchClient: Client) {
  const channelIndexExists = (
    await opensearchClient.indices.exists({
      index: CHANNEL_INDEX,
    })
  ).body;
  if (!channelIndexExists) {
    console.log(`${CHANNEL_INDEX} index does not exist, creating...`);

    await opensearchClient.indices.create({
      index: CHANNEL_INDEX,
      body: {
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
      },
    });
  } else {
    console.log(`${CHANNEL_INDEX} index already exists`);
  }
}

async function createDocumentIndex(opensearchClient: Client) {
  const documentIndexExists = (
    await opensearchClient.indices.exists({
      index: DOCUMENT_INDEX,
    })
  ).body;
  if (!documentIndexExists) {
    console.log(`${DOCUMENT_INDEX} index does not exist, creating...`);

    await opensearchClient.indices.create({
      index: DOCUMENT_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '1s',
        },
        mappings: {
          dynamic: 'false',
          properties: {
            // The id of the document
            entity_id: {
              type: 'keyword',
            },
            // The node id of the document
            // For markdown, this is the parent node of a given text section
            // For pdf/docx, this is just a uuid that is not used
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
      },
    });
  } else {
    console.log(`${DOCUMENT_INDEX} index already exists`);
  }
}

async function createChatIndex(opensearchClient: Client) {
  const chatIndexExists = (
    await opensearchClient.indices.exists({
      index: CHAT_INDEX,
    })
  ).body;
  if (!chatIndexExists) {
    console.log(`${CHAT_INDEX} index does not exist, creating...`);

    await opensearchClient.indices.create({
      index: CHAT_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '1s',
        },
        mappings: {
          dynamic: 'false',
          properties: {
            /* All chat messages are put into OpenSearch under a chat index and are associated by their chat_id, chat_message_id, user_id, role, updated_at, title and content. */
            // The id of the chat
            entity_id: {
              type: 'keyword',
            },
            // The chat message id
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
      },
    });
  } else {
    console.log(`${CHAT_INDEX} index already exists`);
  }
}

async function createEmailIndex(opensearchClient: Client) {
  const emailIndexExists = (
    await opensearchClient.indices.exists({
      index: EMAIL_INDEX,
    })
  ).body;
  if (!emailIndexExists) {
    console.log(`${EMAIL_INDEX} index does not exist, creating...`);

    await opensearchClient.indices.create({
      index: EMAIL_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '2s', // We don't need emails to refresh often
        },
        mappings: {
          dynamic: 'false',
          properties: {
            // The thread id of the email
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
              index: false, // do not index labels
              doc_values: true,
            },
            // link id
            link_id: {
              type: 'keyword',
              index: true,
              doc_values: true,
            },
            // macro user id
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
      },
    });
  } else {
    console.log(`${EMAIL_INDEX} index already exists`);
  }
}

async function createCallRecordsIndex(opensearchClient: Client) {
  const callRecordsIndexExists = (
    await opensearchClient.indices.exists({
      index: CALL_RECORDS_INDEX,
    })
  ).body;
  if (!callRecordsIndexExists) {
    console.log(`${CALL_RECORDS_INDEX} index does not exist, creating...`);

    await opensearchClient.indices.create({
      index: CALL_RECORDS_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '2s',
        },
        aliases: {
          [CALL_RECORDS_ALIAS]: {},
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
            // Aliases for the shared `updated_at_sort` script.
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
      },
    });
  } else {
    console.log(`${CALL_RECORDS_INDEX} index already exists`);
  }
}

async function createIndices() {
  const opensearchClient = client();
  console.log('Creating indices...');

  try {
    await createDocumentIndex(opensearchClient);
    await createChatIndex(opensearchClient);
    await createEmailIndex(opensearchClient);
    await createChannelIndex(opensearchClient);
    await createCallRecordsIndex(opensearchClient);
    console.log('done');
  } catch (error) {
    console.error('Error', error);
  }
}

createIndices();
