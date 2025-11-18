import { client } from '../client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
} from '../constants';

const indices = [
  /* DOCUMENT_INDEX, CHAT_INDEX, EMAIL_INDEX, CHANNEL_INDEX */
];

async function deleteIndices() {
  const opensearchClient = client();
  console.log('Deleting indices...');

  try {
    for (const index of indices) {
      const indexExists = await opensearchClient.indices.exists({
        index,
      });
      if (indexExists) {
        console.log(`${index} index exists, deleting...`);
        const result = await opensearchClient.indices.delete({
          index,
        });
        console.log(`${index} index deleted`, result.body);
      } else {
        console.log(`${index} index does not exist`);
      }
    }
  } catch (error) {
    console.error('Error', error);
  }
}

deleteIndices();
