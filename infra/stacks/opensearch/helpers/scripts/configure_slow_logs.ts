import { client } from '../client';

async function configureSlowLogs() {
  const opensearchClient = client();
  console.log('Configuring slow query logging thresholds...');

  try {
    // Configure slow query thresholds for all indices
    const response = await opensearchClient.indices.putSettings({
      index: '_all',
      body: {
        // Search query slow logs
        'index.search.slowlog.threshold.query.warn': '5s',
        'index.search.slowlog.threshold.query.info': '2s',

        // Search fetch slow logs
        'index.search.slowlog.threshold.fetch.warn': '5s',
        'index.search.slowlog.threshold.fetch.info': '2s',

        // Indexing slow logs
        'index.indexing.slowlog.threshold.index.warn': '5s',
        'index.indexing.slowlog.threshold.index.info': '2s',

        // Slow log level - only log INFO and above (no DEBUG/TRACE)
        'index.search.slowlog.level': 'info',
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
    console.log('  - Queries > 5s: WARN level');
    console.log('  - Queries > 2s: INFO level');
  } catch (error) {
    console.error('❌ Error configuring slow logs:', error);
    throw error;
  }
}

configureSlowLogs();
