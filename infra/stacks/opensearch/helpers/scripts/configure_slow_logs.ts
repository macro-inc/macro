import { client } from '../client';
import { SLOWLOG_SETTINGS } from '../constants';

async function configureSlowLogs() {
  const opensearchClient = client();
  console.log('Configuring slow query logging thresholds...');

  try {
    // Configure slow query thresholds for all indices. Search thresholds come
    // from the shared SLOWLOG_SETTINGS so existing indices match what new ones
    // are created with.
    const response = await opensearchClient.indices.putSettings({
      index: '_all',
      body: {
        ...SLOWLOG_SETTINGS,

        // Indexing slow logs
        'index.indexing.slowlog.threshold.index.warn': '5s',
        'index.indexing.slowlog.threshold.index.info': '2s',
        'index.indexing.slowlog.level': 'info',
      },
    });

    console.log('✅ Slow log thresholds configured successfully');
    console.log('Response:', response.body);

    // Verify settings were applied
    const settings = await opensearchClient.indices.getSettings({
      index: '_all',
    });

    console.log('\n📊 Current slow log settings (sample from first index):');
    const firstIndex = Object.keys(settings.body)[0];
    if (firstIndex) {
      const indexSettings = settings.body[firstIndex].settings.index;
      console.log(
        'Search query warn threshold:',
        indexSettings?.search?.slowlog?.threshold?.query?.warn
      );
      console.log(
        'Search fetch warn threshold:',
        indexSettings?.search?.slowlog?.threshold?.fetch?.warn
      );
      console.log(
        'Indexing warn threshold:',
        indexSettings?.indexing?.slowlog?.threshold?.index?.warn
      );
    }

    console.log('\n📝 Slow queries will now be logged to CloudWatch:');
    console.log('  - Search queries/fetches > 1s: WARN level');
    console.log('  - Search queries/fetches > 300ms: INFO level');
  } catch (error) {
    console.error('❌ Error configuring slow logs:', error);
    throw error;
  }
}

configureSlowLogs();
