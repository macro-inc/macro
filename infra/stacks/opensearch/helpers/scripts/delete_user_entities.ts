import { client } from '../client';

/**
 * Delete User Entities Script
 *
 * This script deletes all items from specified OpenSearch indices that belong to a specific user.
 * It searches for items where either the 'user_id' or 'owner_id' field matches the target user ID.
 *
 * Required Environment Variables:
 * - USER_ID: The user ID to delete data for (e.g., "macro|user@example.com")
 * - INDICES: Comma-separated list of index names to process (e.g., "documents,emails,chats")
 * - OPENSEARCH_URL: The OpenSearch cluster endpoint URL
 * - OPENSEARCH_USERNAME: Username for OpenSearch authentication
 * - OPENSEARCH_PASSWORD: Password for OpenSearch authentication
 **
 * The script will:
 * 1. Connect to OpenSearch using the provided credentials
 * 2. For each specified index, count documents matching the user
 * 3. Delete all matching documents using deleteByQuery
 * 4. Verify deletion by counting remaining documents
 */

// Get user_id and indices from environment variables
const userId = process.env.USER_ID;
const indicesEnv = process.env.INDICES;

if (!userId || !indicesEnv) {
  console.error('Missing required environment variables:');
  console.error('USER_ID - the user ID to delete data for');
  console.error(
    'INDICES - comma-separated list of index names (e.g., "documents,chats,emails")'
  );
  process.exit(1);
}

const indicesToProcess = indicesEnv.split(',').map((index) => index.trim());

async function deleteUserData() {
  const opensearchClient = client();
  console.log(
    `Deleting data for user_id: ${userId} from indices: ${indicesToProcess.join(', ')}`
  );

  try {
    for (const index of indicesToProcess) {
      console.log(`Processing index: ${index}`);

      // Check if index exists
      const indexExists = await opensearchClient.indices.exists({
        index,
      });

      if (!indexExists.body) {
        console.log(`Index ${index} does not exist, skipping...`);
        continue;
      }

      // Query for documents with user_id OR owner_id matching the value
      const query = {
        bool: {
          should: [
            {
              term: {
                user_id: userId,
              },
            },
            {
              term: {
                owner_id: userId,
              },
            },
          ],
          minimum_should_match: 1,
        },
      };

      // First, let's count how many documents we'll be deleting
      const countResult = await opensearchClient.count({
        index,
        body: {
          query,
        },
      });

      const docCount = countResult.body.count;
      console.log(
        `Found ${docCount} documents with user_id OR owner_id: ${userId} in ${index}`
      );

      if (docCount === 0) {
        console.log(`No documents to delete in ${index}`);
        continue;
      }

      // Delete documents by query
      await opensearchClient.deleteByQuery({
        index,
        body: {
          query,
        },
        refresh: true, // Refresh the index after deletion
      });

      console.log(`Delete operation completed for ${index}`);

      // Verify deletion by counting again
      const verifyResult = await opensearchClient.count({
        index,
        body: {
          query,
        },
      });

      const remainingCount = verifyResult.body.count;
      const deletedCount = docCount - remainingCount;
      console.log(
        `Deleted ${deletedCount} documents from ${index} (${remainingCount} remaining)`
      );
    }

    console.log('User data deletion completed');
  } catch (error) {
    console.error('Error deleting user data:', error);
    process.exit(1);
  }
}

deleteUserData();
