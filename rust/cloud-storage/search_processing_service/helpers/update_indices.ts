import type { Property } from '@opensearch-project/opensearch/api/_types/_common.mapping';
import { client } from './client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
} from './constants';

// const indexToUpdate = DOCUMENT_INDEX;
// const indexToUpdate = CHAT_INDEX;
// const indexToUpdate = EMAIL_INDEX;
// const indexToUpdate = CHANNEL_INDEX;

const fieldsToAdd: Record<string, Property> = {
  viewed_at: {
    type: 'date',
    index: false,
    doc_values: true,
  },
};

async function addFieldToIndex() {
  const opensearchClient = client();

  try {
    const response = await opensearchClient.indices.putMapping({
      index: indexToUpdate,
      body: {
        properties: fieldsToAdd,
      },
    });

    console.log(`Successfully updated index: ${indexToUpdate}`);
    Object.keys(fieldsToAdd).forEach((fieldName) => {
      console.log(
        `Added field: ${fieldName} with type: ${fieldsToAdd[fieldName].type}`
      );
    });
    console.log('API response:', response.body);
  } catch (error) {
    console.error(`Error updating index ${indexToUpdate}:`, error);
  }
}

addFieldToIndex();
