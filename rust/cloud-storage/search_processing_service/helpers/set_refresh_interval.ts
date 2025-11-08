import type { Client } from '@opensearch-project/opensearch';
import { client } from './client';
import {
  CHANNEL_INDEX,
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  PROJECT_INDEX,
} from './constants';

interface RefreshConfig {
  [indexName: string]: string;
}

// Define refresh intervals for each index based on usage patterns
const REFRESH_INTERVALS: RefreshConfig = {
  [CHAT_INDEX]: '1s',
  [CHANNEL_INDEX]: '1s',
  [EMAIL_INDEX]: '2s',
  [DOCUMENT_INDEX]: '1s',
  [PROJECT_INDEX]: '1s',
};

async function updateIndexRefreshInterval(
  opensearchClient: Client,
  indexName: string,
  refreshInterval: string
): Promise<void> {
  try {
    console.log(
      `Updating ${indexName} refresh interval to ${refreshInterval}...`
    );

    // Check if index exists first
    const indexExists = (
      await opensearchClient.indices.exists({
        index: indexName,
      })
    ).body;

    if (!indexExists) {
      console.warn(`Index ${indexName} does not exist, skipping...`);
      return;
    }

    // Update the refresh interval setting
    const response = await opensearchClient.indices.putSettings({
      index: indexName,
      body: {
        settings: {
          refresh_interval: refreshInterval,
        },
      },
    });

    if (response.body.acknowledged) {
      console.log(
        `✅ Successfully updated ${indexName} refresh interval to ${refreshInterval}`
      );
    } else {
      console.error(`❌ Failed to update ${indexName} refresh interval`);
    }

    // Verify the setting was applied
    const settings = await opensearchClient.indices.getSettings({
      index: indexName,
    });

    const currentRefreshInterval =
      settings.body[indexName]?.settings?.index?.refresh_interval;
    console.log(
      `   Current refresh interval for ${indexName}: ${currentRefreshInterval}`
    );
  } catch (error) {
    console.error(`Error updating refresh interval for ${indexName}:`, error);
    throw error;
  }
}

async function patchAllRefreshIntervals(
  opensearchClient: Client
): Promise<void> {
  console.log('Starting refresh interval updates for all indices...\n');

  const results: {
    index: string;
    status: string;
    interval: string;
    error?: string;
  }[] = [];

  for (const [indexName, refreshInterval] of Object.entries(
    REFRESH_INTERVALS
  )) {
    try {
      await updateIndexRefreshInterval(
        opensearchClient,
        indexName,
        refreshInterval
      );
      results.push({
        index: indexName,
        status: 'success',
        interval: refreshInterval,
      });
    } catch (error) {
      console.error(`Failed to update ${indexName}:`, error);
      results.push({
        index: indexName,
        status: 'error',
        interval: refreshInterval,
        error: error.message,
      });
    }
  }

  // Summary
  console.log('\n📊 Update Summary:');
  console.log('==================');

  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'error');

  if (successful.length > 0) {
    console.log('\n✅ Successfully Updated:');
    successful.forEach((result) => {
      console.log(`   ${result.index}: ${result.interval}`);
    });
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed Updates:');
    failed.forEach((result) => {
      console.log(`   ${result.index}: ${result.error}`);
    });
  }

  console.log(
    `\nTotal: ${successful.length} successful, ${failed.length} failed`
  );
}

// Function to update a specific index (utility function)
async function patchSingleIndex(
  indexName: string,
  refreshInterval: string
): Promise<void> {
  const opensearchClient = client();

  console.log(`Updating single index: ${indexName} to ${refreshInterval}`);
  await updateIndexRefreshInterval(
    opensearchClient,
    indexName,
    refreshInterval
  );
}

// Function to get current refresh intervals for all indices
async function getCurrentRefreshIntervals(): Promise<void> {
  const opensearchClient = client();

  console.log('Current refresh intervals:');
  console.log('=========================');

  for (const indexName of Object.keys(REFRESH_INTERVALS)) {
    try {
      const indexExists = (
        await opensearchClient.indices.exists({ index: indexName })
      ).body;

      if (!indexExists) {
        console.log(`${indexName}: Index does not exist`);
        continue;
      }

      const settings = await opensearchClient.indices.getSettings({
        index: indexName,
      });
      const refreshInterval =
        settings.body[indexName]?.settings?.index?.refresh_interval ||
        '1s (default)';

      console.log(`${indexName}: ${refreshInterval}`);
    } catch (error) {
      console.log(`${indexName}: Error getting settings - ${error.message}`);
    }
  }
}

// Main execution function
async function main(): Promise<void> {
  const opensearchClient = client();

  try {
    // Show current settings first
    await getCurrentRefreshIntervals();
    console.log('\n' + '='.repeat(50) + '\n');

    // Update all refresh intervals
    await patchAllRefreshIntervals(opensearchClient);
  } catch (error) {
    console.error('Error in main execution:', error);
    process.exit(1);
  }
}

// Export functions for use in other files
export {
  patchAllRefreshIntervals,
  patchSingleIndex,
  getCurrentRefreshIntervals,
  updateIndexRefreshInterval,
  REFRESH_INTERVALS,
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n🎉 Refresh interval updates completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}
