import type { Client } from '@opensearch-project/opensearch';
import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECT_INDEX,
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

    opensearchClient.indices.create({
      index: CHANNEL_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '1s',
        },
        mappings: {
          properties: {
            // channel id
            entity_id: {
              type: 'keyword',
            },
            channel_name: {
              type: 'text',
              fields: {
                keyword: {
                  type: 'keyword',
                  ignore_above: 128,
                },
              },
              index: true,
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

    opensearchClient.indices.create({
      index: DOCUMENT_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '1s',
        },
        mappings: {
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

    opensearchClient.indices.create({
      index: CHAT_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '1s',
        },
        mappings: {
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

    opensearchClient.indices.create({
      index: EMAIL_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '2s', // We don't need emails to refresh often
        },
        mappings: {
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

async function createProjectIndex(opensearchClient: Client) {
  const projectIndexExists = (
    await opensearchClient.indices.exists({
      index: PROJECT_INDEX,
    })
  ).body;
  if (!projectIndexExists) {
    console.log(`${PROJECT_INDEX} index does not exist, creating...`);

    opensearchClient.indices.create({
      index: PROJECT_INDEX,
      body: {
        settings: {
          ...SHARD_SETTINGS,
          refresh_interval: '1s', // Default is 1s
        },
        mappings: {
          properties: {
            // The project id
            entity_id: {
              type: 'keyword',
            },
            user_id: {
              type: 'keyword',
              index: true,
              doc_values: true,
            },
            parent_project_id: {
              type: 'keyword',
              index: true,
              doc_values: true,
            },
            project_name: {
              type: 'text',
              fields: {
                keyword: {
                  type: 'keyword',
                  ignore_above: 128,
                },
              },
            },
            updated_at_seconds: {
              type: 'date',
              format: 'epoch_second',
              index: false,
              doc_values: true,
            },
            created_at_seconds: {
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
    console.log(`${PROJECT_INDEX} index already exists`);
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
    await createProjectIndex(opensearchClient);
    console.log('done');
  } catch (error) {
    console.error('Error', error);
  }
}

createIndices();
